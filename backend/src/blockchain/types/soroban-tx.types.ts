export interface SorobanTxJob {
  contractMethod: string;
  args: unknown[];
  idempotencyKey: string;
  maxRetries?: number;
  metadata?: Record<string, unknown>;
}

export interface SorobanTxResult {
  success?: boolean;
  jobId: string;
  transactionHash?: string;
  status: 'pending' | 'completed' | 'failed' | 'dlq';
  error?: string;
  retryCount: number;
  createdAt: Date;
  completedAt?: Date;
}

/** Finality status emitted after confirmation-depth check. */
export type TxFinalityStatus = 'confirmed' | 'final';

export interface ConfirmationState {
  transactionHash: string;
  confirmations: number;
  finalityThreshold: number;
  status: TxFinalityStatus;
}

export interface QueueMetrics {
  /** Current number of jobs waiting + active in the main queue. */
  queueDepth: number;
  /** Number of jobs in the failed state in the main queue. */
  failedJobs: number;
  /** Current depth of the dead-letter queue. */
  dlqCount: number;
  /** Jobs processed per second (rolling, 0 if not calculated). */
  processingRate: number;
  /** Cumulative counters since process start (or last reset). */
  counters: {
    queued: number;
    processing: number;
    success: number;
    failure: number;
    retries: number;
    dlq: number;
  };
  /** Processing duration statistics for successful jobs. */
  timings: {
    avgMs: number;
    minMs: number;
    maxMs: number;
    samples: number;
  };
}
