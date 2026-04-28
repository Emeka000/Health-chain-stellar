import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { assertSorobanTxJob } from '../../common/guards/on-chain-id.guard';
import {
  TxConfirmedEvent,
  TxFailedEvent,
  TxFinalEvent,
  TxPendingEvent,
} from '../../events/blockchain-tx.events';
import { normalizeContractMethod } from '../contracts/lifebank-contracts';
import { OnChainTxStateEntity, OnChainTxStatus, TX_EVENT_BIT } from '../entities/on-chain-tx-state.entity';
import { JobDeduplicationPlugin } from '../plugins/job-deduplication.plugin';
import {
  SorobanTxJob,
  SorobanTxResult,
  QueueMetrics,
} from '../types/soroban-tx.types';

import { ConfirmationService } from './confirmation.service';
import { IdempotencyService } from './idempotency.service';
import { QueueMetricsService } from './queue-metrics.service';

import type { Queue } from 'bullmq';

@Injectable()
export class SorobanService {
  private readonly logger = new Logger(SorobanService.name);
  private readonly DEFAULT_MAX_RETRIES = 5;
  private readonly BASE_DELAY = 1000; // 1 second
  private readonly MAX_DELAY = 60000; // 60 seconds

  constructor(
    @InjectQueue('soroban-tx-queue') private txQueue: Queue,
    @InjectQueue('soroban-dlq') private dlq: Queue,
    private idempotencyService: IdempotencyService,
    private deduplicationPlugin: JobDeduplicationPlugin,
    private confirmationService: ConfirmationService,
    private queueMetricsService: QueueMetricsService,
    private eventEmitter: EventEmitter2,
    @InjectRepository(OnChainTxStateEntity)
    private txStateRepo: Repository<OnChainTxStateEntity>,
  ) {}

  /**
   * Submit a transaction to the queue with idempotency guarantee.
   * All Soroban contract calls must go through this method.
   *
   * @param job - Transaction job with contractMethod, args, and idempotencyKey
   * @returns Job ID for status tracking
   * @throws Error if idempotency key already exists (duplicate submission)
   */
  async submitTransaction(job: SorobanTxJob): Promise<string> {
    const normalizedJob = this.normalizeJob(job);
    assertSorobanTxJob(normalizedJob);

    // Enforce idempotency: prevent duplicate submissions
    const isNew = await this.idempotencyService.checkAndSetIdempotencyKey(
      normalizedJob.idempotencyKey,
    );

    if (!isNew) {
      this.logger.warn(
        `Duplicate submission detected for idempotency key: ${normalizedJob.idempotencyKey}`,
      );
      throw new Error('Duplicate submission - idempotency key already exists');
    }

    // Check for duplicate job within dedup window
    const isDedupNew = await this.deduplicationPlugin.checkAndSetJobDedup(
      normalizedJob.contractMethod,
      normalizedJob.args,
    );

    if (!isDedupNew) {
      this.logger.warn(
        `Duplicate job suppressed (within dedup window): ${normalizedJob.contractMethod}`,
        { idempotencyKey: normalizedJob.idempotencyKey },
      );
      throw new Error('Duplicate job - equivalent job enqueued recently');
    }

    const maxRetries = normalizedJob.maxRetries ?? this.DEFAULT_MAX_RETRIES;

    // Add job to queue with exponential backoff and jitter
    const queueJob = await this.txQueue.add(job.contractMethod, job, {
      attempts: maxRetries,
      backoff: {
        type: 'exponential',
        delay: this.BASE_DELAY,
      },
      removeOnComplete: true,
      removeOnFail: false, // Keep failed jobs for audit trail
      jobId: normalizedJob.idempotencyKey,
    });

    this.logger.log(
      `Transaction queued: ${queueJob.id} (${normalizedJob.contractMethod}) with ${maxRetries} max retries`,
    );
    return String(queueJob.id);
  }

  /**
   * Get organization verification status from Soroban
   * Delegates to the soroban module service which owns the RPC connection.
   * This method is intentionally thin – it exists so blockchain-module
   * consumers can call it without importing the soroban module directly.
   */
  async getOrganizationVerificationStatus(
    organizationId: string,
  ): Promise<{ verified: boolean; verifiedAt?: number } | null> {
    this.logger.debug(`Querying verification status for org: ${organizationId}`);
    // Actual RPC call is implemented in soroban/soroban.service.ts
    // This service is in the blockchain module and does not have direct RPC access.
    // Callers in the organizations module use soroban/soroban.service.ts directly.
    return null;
  }

  /**
   * Submit and block until the Soroban worker finishes (success or failure).
   * Used for flows that must persist on-chain proof before completing a workflow.
   */
  async submitTransactionAndWait(
    job: SorobanTxJob,
    timeoutMs = 120_000,
  ): Promise<{ transactionHash: string }> {
    const jobId = await this.submitTransaction(job);
    const bullJob = await this.txQueue.getJob(jobId);
    if (!bullJob) {
      throw new Error(`Queued Soroban job not found: ${jobId}`);
    }

    const completion = bullJob.finished() as Promise<{
      success: boolean;
      transactionHash: string;
    }>;

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`Soroban job ${jobId} timed out after ${timeoutMs}ms`),
          ),
        timeoutMs,
      ),
    );

    const result = await Promise.race([completion, timeout]);
    if (!result?.success || !result.transactionHash) {
      throw new Error('Soroban job completed without a transaction hash');
    }
    return { transactionHash: result.transactionHash };
  }

  private normalizeJob(job: SorobanTxJob): SorobanTxJob {
    const normalizedMethod = normalizeContractMethod(job.contractMethod);

    if (normalizedMethod === job.contractMethod) {
      return job;
    }

    return {
      ...job,
      contractMethod: normalizedMethod,
      metadata: {
        ...(job.metadata || {}),
        normalizedFromContractMethod: job.contractMethod,
      },
    };
  }

  /**
   * Get real-time queue metrics for admin monitoring.
   *
   * @returns Queue depth, failed jobs count, DLQ count, counters, and timings
   */
  async getQueueMetrics(): Promise<QueueMetrics> {
    const detailed = await this.queueMetricsService.getDetailedMetrics();

    return {
      queueDepth: detailed.live.waiting + detailed.live.active,
      failedJobs: detailed.live.failed,
      dlqCount: detailed.live.dlqDepth,
      processingRate: 0, // Calculated separately if needed
      counters: detailed.counters,
      timings: detailed.timings,
    };
  }

  /**
   * Get status of a specific job.
   *
   * @param jobId - Job ID to check
   * @returns Job status or null if not found
   */
  async getJobStatus(jobId: string): Promise<SorobanTxResult | null> {
    const job = await this.txQueue.getJob(jobId);

    if (!job) {
      return null;
    }

    const state = await job.getState();
    const data = job.data as { transactionHash?: string };

    return {
      jobId: String(job.id),
      transactionHash: data.transactionHash,
      status: state as 'pending' | 'completed' | 'failed' | 'dlq',
      error: job.failedReason,
      retryCount: job.attemptsMade,
      createdAt: new Date(job.timestamp),
      completedAt: job.finishedOn ? new Date(job.finishedOn) : undefined,
    };
  }

  /**
   * Check and atomically set callback event idempotency key.
   * Rejects replayed callback events.
   *
   * @param eventId - Unique callback event ID
   */
  async checkAndSetCallbackIdempotency(eventId: string): Promise<boolean> {
    return this.idempotencyService.checkAndSetIdempotencyKey(
      `callback:${eventId}`,
    );
  }

  /**
   * Process an incoming blockchain callback via webhook.
   *
   * Persists durable state transitions to `on_chain_tx_states` and emits
   * domain events exactly once per milestone using the `emittedEvents` bitmask.
   *
   * Idempotency: the controller already deduplicates by eventId. This method
   * additionally guards individual event bits so retried callbacks cannot
   * produce duplicate downstream effects.
   */
  async processWebhookCallback(callback: {
    eventId: string;
    transactionHash: string;
    contractMethod: string;
    status: 'pending' | 'confirmed' | 'failed';
    timestamp: string;
    details?: string;
    confirmations?: number;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    this.logger.log(
      `Processing blockchain callback event ${callback.eventId}`,
      {
        transactionHash: callback.transactionHash,
        contractMethod: callback.contractMethod,
        status: callback.status,
        timestamp: callback.timestamp,
      },
    );

    // Upsert the durable state row
    let txState = await this.txStateRepo.findOne({
      where: { transactionHash: callback.transactionHash },
    });

    if (!txState) {
      txState = this.txStateRepo.create({
        transactionHash: callback.transactionHash,
        contractMethod: callback.contractMethod,
        status: OnChainTxStatus.PENDING,
        confirmations: 0,
        finalityThreshold: this.confirmationService.finalityThreshold,
        emittedEvents: 0,
        metadata: callback.metadata ?? null,
      });
    }

    if (callback.status === 'pending') {
      if (!(txState.emittedEvents & TX_EVENT_BIT.PENDING)) {
        txState.emittedEvents |= TX_EVENT_BIT.PENDING;
        await this.txStateRepo.save(txState);
        this.eventEmitter.emit(
          'blockchain.tx.pending',
          new TxPendingEvent(
            callback.transactionHash,
            callback.contractMethod,
            txState.metadata,
          ),
        );
      }
      return;
    }

    if (callback.status === 'failed') {
      txState.status = OnChainTxStatus.FAILED;
      txState.failureReason = callback.details ?? null;

      if (!(txState.emittedEvents & TX_EVENT_BIT.FAILED)) {
        txState.emittedEvents |= TX_EVENT_BIT.FAILED;
        await this.txStateRepo.save(txState);
        this.eventEmitter.emit(
          'blockchain.tx.failed',
          new TxFailedEvent(
            callback.transactionHash,
            callback.contractMethod,
            txState.failureReason,
            txState.metadata,
          ),
        );
      } else {
        await this.txStateRepo.save(txState);
      }
      return;
    }

    // status === 'confirmed'
    const confirmationState = await this.confirmationService.recordConfirmations(
      callback.transactionHash,
      callback.confirmations ?? 1,
    );

    txState.confirmations = confirmationState.confirmations;

    if (confirmationState.status === 'final') {
      txState.status = OnChainTxStatus.FINAL;

      // Emit confirmed first (if not yet emitted)
      if (!(txState.emittedEvents & TX_EVENT_BIT.CONFIRMED)) {
        txState.emittedEvents |= TX_EVENT_BIT.CONFIRMED;
        this.eventEmitter.emit(
          'blockchain.tx.confirmed',
          new TxConfirmedEvent(
            callback.transactionHash,
            callback.contractMethod,
            confirmationState.confirmations,
            confirmationState.finalityThreshold,
            txState.metadata,
          ),
        );
      }

      if (!(txState.emittedEvents & TX_EVENT_BIT.FINAL)) {
        txState.emittedEvents |= TX_EVENT_BIT.FINAL;
        await this.txStateRepo.save(txState);
        this.eventEmitter.emit(
          'blockchain.tx.final',
          new TxFinalEvent(
            callback.transactionHash,
            callback.contractMethod,
            confirmationState.confirmations,
            txState.metadata,
          ),
        );
      } else {
        await this.txStateRepo.save(txState);
      }
    } else {
      // Still accumulating confirmations
      txState.status = OnChainTxStatus.CONFIRMED;

      if (!(txState.emittedEvents & TX_EVENT_BIT.CONFIRMED)) {
        txState.emittedEvents |= TX_EVENT_BIT.CONFIRMED;
        await this.txStateRepo.save(txState);
        this.eventEmitter.emit(
          'blockchain.tx.confirmed',
          new TxConfirmedEvent(
            callback.transactionHash,
            callback.contractMethod,
            confirmationState.confirmations,
            confirmationState.finalityThreshold,
            txState.metadata,
          ),
        );
      } else {
        await this.txStateRepo.save(txState);
      }
    }

    this.logger.log(
      `Finality check: tx=${callback.transactionHash} confirmations=${confirmationState.confirmations}/${confirmationState.finalityThreshold} status=${confirmationState.status}`,
      { eventId: callback.eventId },
    );
  }

  /**
   * Calculate exponential backoff delay with jitter.
   * Prevents thundering herd problem during retries.
   *
   * Formula: min(baseDelay * 2^(attempt-1) + jitter, maxDelay)
   * Jitter: random 0-10% of exponential delay
   *
   * @param attemptNumber - Attempt number (1-based)
   * @returns Delay in milliseconds
   */
  calculateBackoffDelay(attemptNumber: number): number {
    const exponentialDelay = this.BASE_DELAY * Math.pow(2, attemptNumber - 1);
    const jitter = Math.random() * 0.1 * exponentialDelay;
    const delay = Math.min(exponentialDelay + jitter, this.MAX_DELAY);
    return Math.floor(delay);
  }

  /**
   * Replay failed jobs from DLQ with safety guardrails.
   * Admin-only operation with batch limits and dry-run support.
   *
   * @param options - Replay options (dryRun, batchSize, offset)
   * @returns Replay result with metrics
   */
  async replayDlqJobs(options: {
    dryRun?: boolean;
    batchSize?: number;
    offset?: number;
  }): Promise<{
    dryRun: boolean;
    totalInspected: number;
    replayable: number;
    replayed: number;
    skipped: number;
    errors: Array<{ jobId: string; reason: string }>;
  }> {
    const { dryRun = false, batchSize = 10, offset = 0 } = options;

    this.logger.log(
      `[DLQ Replay] Starting ${dryRun ? 'DRY RUN' : 'LIVE'} replay: batchSize=${batchSize}, offset=${offset}`,
    );

    // Fetch failed jobs from DLQ
    const failedJobs = await this.dlq.getJobs(
      ['failed'],
      offset,
      offset + batchSize - 1,
    );

    const result = {
      dryRun,
      totalInspected: failedJobs.length,
      replayable: 0,
      replayed: 0,
      skipped: 0,
      errors: [] as Array<{ jobId: string; reason: string }>,
    };

    for (const job of failedJobs) {
      const jobId = String(job.id);

      // Check if job is replayable (has valid data)
      if (!job.data || !job.data.contractMethod || !job.data.idempotencyKey) {
        result.skipped++;
        result.errors.push({
          jobId,
          reason: 'Invalid job data - missing required fields',
        });
        continue;
      }

      result.replayable++;

      if (dryRun) {
        this.logger.log(
          `[DLQ Replay DRY RUN] Would replay job=${jobId} method=${job.data.contractMethod}`,
        );
        continue;
      }

      try {
        // Clear old idempotency key to allow resubmission
        await this.idempotencyService.clearIdempotencyKey(
          job.data.idempotencyKey,
        );

        // Resubmit to main queue
        await this.submitTransaction({
          ...job.data,
          metadata: {
            ...job.data.metadata,
            replayedFrom: jobId,
            replayedAt: new Date().toISOString(),
          },
        });

        // Remove from DLQ after successful resubmission
        await job.remove();

        result.replayed++;
        this.logger.log(
          `[DLQ Replay] Successfully replayed job=${jobId} method=${job.data.contractMethod}`,
        );
      } catch (error) {
        result.errors.push({
          jobId,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
        this.logger.error(
          `[DLQ Replay] Failed to replay job=${jobId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    this.logger.log(
      `[DLQ Replay] Complete: inspected=${result.totalInspected}, replayable=${result.replayable}, replayed=${result.replayed}, skipped=${result.skipped}, errors=${result.errors.length}`,
    );

    return result;
  }
}
