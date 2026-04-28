import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { CompensationService } from '../../common/compensation/compensation.service';
import {
  BlockchainTxIrrecoverableError,
  CompensationAction,
} from '../../common/errors/app-errors';
import { FailedSorobanTxService } from '../services/failed-soroban-tx.service';
import { QueueMetricsService } from '../services/queue-metrics.service';

import type { SorobanTxJob } from '../types/soroban-tx.types';
import type { Job } from 'bullmq';

/**
 * Dead Letter Queue Processor
 *
 * Handles Soroban transactions that permanently failed after exhausting all retries.
 * Applies deterministic compensating actions: persist audit record, flag for review,
 * and emit a structured admin alert via the CompensationService.
 */
@Processor('soroban-dlq')
export class SorobanDlqProcessor extends WorkerHost {
  private readonly logger = new Logger(SorobanDlqProcessor.name);

  constructor(
    private readonly compensationService: CompensationService,
    private readonly queueMetricsService: QueueMetricsService,
    private readonly failedTxService: FailedSorobanTxService,
  ) {
    super();
  }

  async process(job: Job<SorobanTxJob>): Promise<void> {
    await this.handleDeadLetterJob(job);
  }

  async handleDeadLetterJob(job: Job<SorobanTxJob>): Promise<void> {
    this.logger.error(
      `[DLQ] Permanent failure for job=${job.id} method=${job.data.contractMethod} attempts=${job.attemptsMade}`,
      { idempotencyKey: job.data.idempotencyKey, metadata: job.data.metadata },
    );

    // Record DLQ counter — the queue event listener also fires, but we call
    // this here as a belt-and-suspenders guarantee from within the processor.
    this.queueMetricsService.incrementDlq();

    // Persist outbox row with status = FAILED for admin replay and health checks
    await this.failedTxService.persistFailure(
      String(job.id),
      job.data,
      job.failedReason ?? 'unknown',
      job.attemptsMade,
    );

    const error = new BlockchainTxIrrecoverableError(
      `Soroban transaction permanently failed after ${job.attemptsMade} attempts: ${job.failedReason ?? 'unknown'}`,
      {
        jobId: String(job.id),
        contractMethod: job.data.contractMethod,
        idempotencyKey: job.data.idempotencyKey,
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        failureReason: job.failedReason,
        stackTrace: job.stacktrace,
        metadata: job.data.metadata ?? {},
      },
    );

    const handlers = [
      {
        action: CompensationAction.PERSIST_DLQ,
        execute: async () => {
          // The CompensationService itself persists the FailureRecord.
          // This handler is a no-op marker so the action appears in the audit trail.
          this.logger.log(`[DLQ] Marking PERSIST_DLQ for job=${job.id}`);
          return true;
        },
      },
      {
        action: CompensationAction.NOTIFY_ADMIN,
        execute: async () => {
          // Structured log at ERROR level — picked up by any log aggregator
          // (CloudWatch, Datadog, etc.) configured to alert on ERROR severity.
          this.logger.error(
            `[ADMIN ALERT] Blockchain transaction requires manual review`,
            {
              jobId: String(job.id),
              contractMethod: job.data.contractMethod,
              idempotencyKey: job.data.idempotencyKey,
              failureReason: job.failedReason,
              attemptsMade: job.attemptsMade,
            },
          );
          return true;
        },
      },
      {
        action: CompensationAction.FLAG_FOR_REVIEW,
        execute: async () => {
          // Persisted via CompensationService → FailureRecordService.
          // Logged here for immediate visibility.
          this.logger.warn(
            `[REVIEW REQUIRED] Soroban job=${job.id} flagged for manual review`,
            { idempotencyKey: job.data.idempotencyKey },
          );
          return true;
        },
      },
    ];

    const result = await this.compensationService.compensate(
      error,
      handlers,
      job.data.idempotencyKey,
    );

    this.logger.log(
      `[DLQ] Compensation complete for job=${job.id}: applied=${result.applied.join(',')} failed=${result.failed.join(',') || 'none'} recordId=${result.failureRecordId}`,
    );
  }
}
