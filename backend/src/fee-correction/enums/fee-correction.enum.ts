export enum FeeCorrectionRunStatus {
  /** Run has been created and is awaiting approval. */
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  /** Approval granted; execution has not started yet. */
  APPROVED = 'APPROVED',
  /** Execution is in progress. */
  RUNNING = 'RUNNING',
  /** All orders processed successfully. */
  COMPLETED = 'COMPLETED',
  /** Run was interrupted mid-way; can be resumed. */
  INTERRUPTED = 'INTERRUPTED',
  /** Run was rejected during the approval workflow. */
  REJECTED = 'REJECTED',
  /** Run failed with an unrecoverable error. */
  FAILED = 'FAILED',
}

export enum FeeAdjustmentEntryStatus {
  /** Entry computed but not yet applied to accounting. */
  PENDING = 'PENDING',
  /** Compensating entry has been generated and linked. */
  APPLIED = 'APPLIED',
  /** Entry was skipped (e.g., delta is zero). */
  SKIPPED = 'SKIPPED',
  /** Entry failed to apply; requires manual review. */
  FAILED = 'FAILED',
}
