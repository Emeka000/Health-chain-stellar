import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import type { Job, Queue } from 'bull';

export interface QueueCounters {
  /** Total jobs added to the main queue since process start. */
  queued: number;
  /** Jobs currently being processed. */
  processing: number;
  /** Jobs that completed successfully. */
  success: number;
  /** Jobs that failed at least once (includes retried). */
  failure: number;
  /** Total retry attempts across all jobs. */
  retries: number;
  /** Jobs moved to the dead-letter queue. */
  dlq: number;
}

export interface ProcessingTimings {
  /** Average processing duration in ms (success jobs only). */
  avgMs: number;
  /** Minimum processing duration in ms. */
  minMs: number;
  /** Maximum processing duration in ms. */
  maxMs: number;
  /** Total samples used for timing stats. */
  samples: number;
}

export interface DetailedQueueMetrics {
  counters: QueueCounters;
  timings: ProcessingTimings;
  /** Live queue depths pulled from Bull at query time. */
  live: {
    waiting: number;
    active: number;
    failed: number;
    delayed: number;
    dlqDepth: number;
  };
  /** ISO timestamp of when the counters were last reset. */
  since: string;
}

@Injectable()
export class QueueMetricsService implements OnModuleInit {
  private readonly logger = new Logger(QueueMetricsService.name);

  private counters: QueueCounters = {
    queued: 0,
    processing: 0,
    success: 0,
    failure: 0,
    retries: 0,
    dlq: 0,
  };

  /** Running timing stats for Welford online algorithm. */
  private timingState = {
    count: 0,
    mean: 0,
    m2: 0,
    min: Infinity,
    max: -Infinity,
  };

  /** Tracks job start times for duration calculation. */
  private readonly jobStartTimes = new Map<string | number, number>();

  private since = new Date().toISOString();

  constructor(
    @InjectQueue('soroban-tx-queue') private readonly txQueue: Queue,
    @InjectQueue('soroban-dlq') private readonly dlq: Queue,
  ) {}

  onModuleInit(): void {
    this.attachQueueListeners();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Called by the DLQ processor when a job lands in the DLQ. */
  incrementDlq(): void {
    this.counters.dlq++;
  }

  /** Called by the TX processor when a retry attempt is made. */
  incrementRetry(): void {
    this.counters.retries++;
  }

  async getDetailedMetrics(): Promise<DetailedQueueMetrics> {
    const [waiting, active, failed, delayed, dlqDepth] = await Promise.all([
      this.txQueue.getWaitingCount(),
      this.txQueue.getActiveCount(),
      this.txQueue.getFailedCount(),
      this.txQueue.getDelayedCount(),
      this.dlq.count(),
    ]);

    return {
      counters: { ...this.counters },
      timings: this.buildTimings(),
      live: { waiting, active, failed, delayed, dlqDepth },
      since: this.since,
    };
  }

  /** Reset all in-memory counters (useful for testing / rolling windows). */
  reset(): void {
    this.counters = {
      queued: 0,
      processing: 0,
      success: 0,
      failure: 0,
      retries: 0,
      dlq: 0,
    };
    this.timingState = {
      count: 0,
      mean: 0,
      m2: 0,
      min: Infinity,
      max: -Infinity,
    };
    this.jobStartTimes.clear();
    this.since = new Date().toISOString();
  }

  // ─── Bull event listeners ──────────────────────────────────────────────────

  private attachQueueListeners(): void {
    // Main queue events
    this.txQueue.on('waiting', (_jobId: string) => {
      this.counters.queued++;
    });

    this.txQueue.on('active', (job: Job) => {
      this.counters.processing++;
      this.jobStartTimes.set(job.id, Date.now());
    });

    this.txQueue.on('completed', (job: Job) => {
      this.counters.processing = Math.max(0, this.counters.processing - 1);
      this.counters.success++;
      this.recordTiming(job.id);
    });

    this.txQueue.on('failed', (job: Job, _err: Error) => {
      this.counters.processing = Math.max(0, this.counters.processing - 1);
      this.counters.failure++;

      // If there are attempts remaining, Bull will retry — count it
      const attemptsRemaining =
        (job.opts.attempts ?? 1) - (job.attemptsMade + 1);
      if (attemptsRemaining > 0) {
        this.counters.retries++;
      }
    });

    this.txQueue.on('stalled', (_job: Job) => {
      // Stalled jobs are re-queued by Bull; treat as a retry
      this.counters.retries++;
      this.logger.warn(`[Metrics] Stalled job detected — counted as retry`);
    });

    // DLQ queue events — the processor also calls incrementDlq() directly,
    // so we do NOT listen to the DLQ 'active' event here to avoid double-counting.
    // The processor call is the authoritative source for DLQ counter increments.

    this.logger.log('[Metrics] Queue event listeners attached');
  }

  // ─── Timing helpers ────────────────────────────────────────────────────────

  private recordTiming(jobId: string | number): void {
    const start = this.jobStartTimes.get(jobId);
    if (start === undefined) return;

    const durationMs = Date.now() - start;
    this.jobStartTimes.delete(jobId);

    // Welford online algorithm for running mean + variance
    const { count, mean, m2 } = this.timingState;
    const newCount = count + 1;
    const delta = durationMs - mean;
    const newMean = mean + delta / newCount;
    const delta2 = durationMs - newMean;

    this.timingState = {
      count: newCount,
      mean: newMean,
      m2: m2 + delta * delta2,
      min: Math.min(this.timingState.min, durationMs),
      max: Math.max(this.timingState.max, durationMs),
    };
  }

  private buildTimings(): ProcessingTimings {
    const { count, mean, min, max } = this.timingState;
    return {
      avgMs: count > 0 ? Math.round(mean) : 0,
      minMs: count > 0 ? min : 0,
      maxMs: count > 0 ? max : 0,
      samples: count,
    };
  }
}
