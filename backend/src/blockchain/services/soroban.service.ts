import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';

import { assertSorobanTxJob } from '../../common/guards/on-chain-id.guard';
import { JobDeduplicationPlugin } from '../plugins/job-deduplication.plugin';
import {
  SorobanTxJob,
  SorobanTxResult,
  QueueMetrics,
} from '../types/soroban-tx.types';

import { IdempotencyService } from './idempotency.service';

import type { Queue } from 'bull';

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
    assertSorobanTxJob(job);

    // Enforce idempotency: prevent duplicate submissions
    const isNew = await this.idempotencyService.checkAndSetIdempotencyKey(
      job.idempotencyKey,
    );

    if (!isNew) {
      this.logger.warn(
        `Duplicate submission detected for idempotency key: ${job.idempotencyKey}`,
      );
      throw new Error('Duplicate submission - idempotency key already exists');
    }

    // Check for duplicate job within dedup window
    const isDedupNew = await this.deduplicationPlugin.checkAndSetJobDedup(
      job.contractMethod,
      job.args,
    );

    if (!isDedupNew) {
      this.logger.warn(
        `Duplicate job suppressed (within dedup window): ${job.contractMethod}`,
        { idempotencyKey: job.idempotencyKey },
      );
      throw new Error('Duplicate job - equivalent job enqueued recently');
    }

    const maxRetries = job.maxRetries ?? this.DEFAULT_MAX_RETRIES;

    // Add job to queue with exponential backoff and jitter
    const queueJob = await this.txQueue.add(job, {
      attempts: maxRetries,
      backoff: {
        type: 'exponential',
        delay: this.BASE_DELAY,
      },
      removeOnComplete: true,
      removeOnFail: false, // Keep failed jobs for audit trail
      jobId: job.idempotencyKey,
    });

    this.logger.log(
      `Transaction queued: ${queueJob.id} (${job.contractMethod}) with ${maxRetries} max retries`,
    );
    return String(queueJob.id);
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
   * Ensures callback data is securely handled and logged.
   *
   * @param callback - Verified callback payload
   */
  async processWebhookCallback(callback: {
    eventId: string;
    transactionHash: string;
    contractMethod: string;
    status: 'pending' | 'confirmed' | 'failed';
    timestamp: string;
    details?: string;
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

    // TODO: map callback to persistent state or queue side effects.
    // e.g., persist to database, update workflow state, or publish domain events.

    await Promise.resolve();
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
}
