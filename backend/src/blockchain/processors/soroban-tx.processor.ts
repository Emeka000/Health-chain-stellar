import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';

import { QueueMetricsService } from '../services/queue-metrics.service';
import { SorobanService } from '../services/soroban.service';

import type { SorobanTxJob, SorobanTxResult } from '../types/soroban-tx.types';
import type { Job } from 'bullmq';

const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30_000;
const DEFAULT_TX_TIMEOUT_SECONDS = 60;
const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_POLL_ATTEMPTS = 60;
const DEFAULT_FEE = '100';

export function computeBackoffDelay(attempt: number): number {
  const windowMs = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS * Math.pow(2, attempt),
  );
  return Math.floor(Math.random() * windowMs);
}

@Injectable()
@Processor('soroban-tx-queue')
export class SorobanTxProcessor extends WorkerHost {
  private readonly logger = new Logger(SorobanTxProcessor.name);

  constructor(
    private readonly queueMetricsService: QueueMetricsService,
    private readonly configService: ConfigService,
    private readonly sorobanService: SorobanService,
  ) {
    super();
  }

  async process(job: Job<SorobanTxJob>): Promise<SorobanTxResult> {
    return this.handleTransaction(job);
  }

  async handleTransaction(job: Job<SorobanTxJob>): Promise<SorobanTxResult> {
    try {
      const transactionHash = await this.executeContractCall(job.data);
      return {
        success: true,
        jobId: String(job.id),
        transactionHash,
        status: 'completed',
        retryCount: job.attemptsMade,
        createdAt: new Date(job.timestamp ?? Date.now()),
        completedAt: new Date(),
      };
    } catch (error) {
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 < maxAttempts) {
        this.queueMetricsService.incrementRetry();
      }
      throw error;
    }
  }

  async handleJobFailure(jobId: string, error: Error): Promise<void> {
    this.logger.error(`Soroban job ${jobId} failed: ${error.message}`);
    await this.alertAdmins(jobId, error);
  }

  /**
   * Called by BullMQ when a job exhausts its attempts and is moved to the DLQ.
   * Releases the idempotency key so the transaction can be resubmitted.
   */
  async onFailed(job: Job<SorobanTxJob>, error: Error): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    const isTerminal = job.attemptsMade >= maxAttempts;
    if (!isTerminal) {
      return;
    }

    await this.handleJobFailure(String(job.id), error);
    await this.releaseIdempotencyKey(job.data);
  }

  private async releaseIdempotencyKey(job: SorobanTxJob): Promise<void> {
    if (!job?.idempotencyKey) {
      return;
    }
    try {
      await this.sorobanService.clearIdempotencyKey(job.idempotencyKey);
    } catch (error) {
      this.logger.error(
        `Failed to clear idempotency key ${job.idempotencyKey}: ${
          (error as Error).message
        }`,
      );
    }
  }

  private async executeContractCall(job: SorobanTxJob): Promise<string> {
    this.logger.debug(
      `Submitting Soroban method ${job.contractMethod} on ${job.contractId}`,
    );

    const rpcUrl = this.configService.get<string>('SOROBAN_RPC_URL');
    const networkPassphrase = this.configService.get<string>(
      'SOROBAN_NETWORK_PASSPHRASE',
    );
    const secretKey = this.configService.get<string>('SOROBAN_SECRET_KEY');

    if (!rpcUrl || !networkPassphrase || !secretKey) {
      throw new Error(
        'Soroban submission is not configured: SOROBAN_RPC_URL, SOROBAN_NETWORK_PASSPHRASE and SOROBAN_SECRET_KEY are required',
      );
    }

    const server = new rpc.Server(rpcUrl, {
      allowHttp: rpcUrl.startsWith('http://'),
    });
    const keypair = Keypair.fromSecret(secretKey);
    const sourceAccount = await server.getAccount(keypair.publicKey());

    const contract = new Contract(job.contractId);
    const args = this.mapArgs(job);
    const operation = contract.call(job.contractMethod, ...args);

    const txTimeout = this.configService.get<number>(
      'SOROBAN_TX_TIMEOUT_SECONDS',
      DEFAULT_TX_TIMEOUT_SECONDS,
    );

    const built = new TransactionBuilder(sourceAccount, {
      fee: this.configService.get<string>('SOROBAN_BASE_FEE', DEFAULT_FEE),
      networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(txTimeout)
      .build();

    const prepared = await server.prepareTransaction(built);
    prepared.sign(keypair);

    const sendResponse = await server.sendTransaction(prepared);
    if (sendResponse.status === 'ERROR') {
      throw new Error(
        `Soroban sendTransaction failed: ${JSON.stringify(
          sendResponse.errorResult ?? sendResponse.status,
        )}`,
      );
    }

    const hash = sendResponse.hash;
    const result = await this.pollTransaction(server, hash);

    if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(
        `Soroban transaction ${hash} finished with status ${result.status}`,
      );
    }

    this.logger.debug(`Soroban transaction ${hash} confirmed`);
    return hash;
  }

  private async pollTransaction(
    server: rpc.Server,
    hash: string,
  ): Promise<rpc.Api.GetTransactionResponse> {
    const attempts = this.configService.get<number>(
      'SOROBAN_POLL_ATTEMPTS',
      DEFAULT_POLL_ATTEMPTS,
    );
    const intervalMs = this.configService.get<number>(
      'SOROBAN_POLL_INTERVAL_MS',
      DEFAULT_POLL_INTERVAL_MS,
    );

    for (let attempt = 0; attempt < attempts; attempt++) {
      const response = await server.getTransaction(hash);
      if (response.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
        return response;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(
      `Soroban transaction ${hash} was not confirmed after ${attempts} polls`,
    );
  }

  private mapArgs(job: SorobanTxJob): xdr.ScVal[] {
    const rawArgs = job.args ?? [];
    if (!Array.isArray(rawArgs)) {
      throw new Error(
        `Soroban job ${job.idempotencyKey} has non-array args; cannot map to ScVal`,
      );
    }

    return rawArgs.map((arg) => this.toScVal(arg));
  }

  private toScVal(arg: unknown): xdr.ScVal {
    if (arg !== null && typeof arg === 'object' && !Array.isArray(arg)) {
      const candidate = arg as { type?: string; value?: unknown };
      if (typeof candidate.type === 'string' && 'value' in candidate) {
        return this.toTypedScVal(candidate.type, candidate.value);
      }
    }
    return nativeToScVal(arg as never);
  }

  private toTypedScVal(type: string, value: unknown): xdr.ScVal {
    switch (type) {
      case 'address':
        return new Address(String(value)).toScVal();
      case 'i128':
      case 'u128':
      case 'i64':
      case 'u64':
      case 'i32':
      case 'u32':
        return nativeToScVal(value as never, { type });
      case 'string':
        return nativeToScVal(String(value), { type: 'string' });
      case 'bool':
        return nativeToScVal(Boolean(value), { type: 'bool' });
      case 'bytes':
        return nativeToScVal(Buffer.from(String(value), 'utf8'), {
          type: 'bytes',
        });
      case 'symbol':
        return nativeToScVal(String(value), { type: 'symbol' });
      default:
        return nativeToScVal(value as never);
    }
  }

  private async alertAdmins(jobId: string, error: Error): Promise<void> {
    this.logger.error(`Admin alert for failed Soroban job ${jobId}`, {
      error: error.message,
    });
  }
}
