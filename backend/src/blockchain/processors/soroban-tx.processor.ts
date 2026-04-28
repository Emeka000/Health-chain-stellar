import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { QueueMetricsService } from '../services/queue-metrics.service';

import type { SorobanTxJob, SorobanTxResult } from '../types/soroban-tx.types';
import type { Job } from 'bullmq';

const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 30_000;

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

  constructor(private readonly queueMetricsService: QueueMetricsService) {
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

  private async executeContractCall(job: SorobanTxJob): Promise<string> {
    this.logger.debug(`Executing Soroban method ${job.contractMethod}`);
    return `tx_${job.idempotencyKey}`;
  }

  private async alertAdmins(jobId: string, error: Error): Promise<void> {
    this.logger.error(`Admin alert for failed Soroban job ${jobId}`, {
      error: error.message,
    });
  }
}
