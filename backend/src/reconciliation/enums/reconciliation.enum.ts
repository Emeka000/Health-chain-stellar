export enum ReconciliationRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  INTERRUPTED = 'interrupted',
}

export enum MismatchType {
  AMOUNT = 'amount',
  STATUS = 'status',
  PARTIES = 'parties',
  TIMESTAMP = 'timestamp',
  PROOF_REF = 'proof_ref',
  MISSING_ON_CHAIN = 'missing_on_chain',
  MISSING_OFF_CHAIN = 'missing_off_chain',
  DUPLICATE = 'duplicate',
  AMBIGUOUS = 'ambiguous',
}

export enum MismatchSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum MismatchResolution {
  PENDING = 'pending',
  RESYNCED = 'resynced',
  MANUAL = 'manual',
  DISMISSED = 'dismissed',
}

/** Exception categories with guided remediation actions */
export enum ExceptionCategory {
  /** On-chain record not found — may need re-submission */
  MISSING_ON_CHAIN = 'missing_on_chain',
  /** Off-chain record not found — may need manual creation */
  MISSING_OFF_CHAIN = 'missing_off_chain',
  /** Multiple on-chain candidates match — operator must choose */
  AMBIGUOUS_MATCH = 'ambiguous_match',
  /** Duplicate on-chain event detected */
  DUPLICATE_EVENT = 'duplicate_event',
  /** Amount tolerance exceeded */
  AMOUNT_DISCREPANCY = 'amount_discrepancy',
  /** Status divergence between on-chain and off-chain */
  STATUS_DIVERGENCE = 'status_divergence',
  /** Timestamp skew beyond tolerance */
  TIMESTAMP_SKEW = 'timestamp_skew',
}

