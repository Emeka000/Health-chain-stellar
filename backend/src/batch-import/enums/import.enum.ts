export enum ImportEntityType {
  ORGANIZATION = 'ORGANIZATION',
  RIDER = 'RIDER',
  INVENTORY = 'INVENTORY',
}

export enum ImportRowStatus {
  VALID = 'VALID',
  INVALID = 'INVALID',
  /** Row was committed successfully to the domain table. */
  COMMITTED = 'COMMITTED',
  /** Row was skipped because an identical record already exists (idempotent dedup). */
  DUPLICATE = 'DUPLICATE',
  /** Row failed during commit (after passing validation). */
  FAILED = 'FAILED',
  /** Row is held in quarantine with structured reason codes. */
  QUARANTINED = 'QUARANTINED',
}

export enum ImportBatchStatus {
  STAGED = 'STAGED',
  /** Processing is in progress (chunks being committed). */
  PROCESSING = 'PROCESSING',
  /** All chunks committed; batch complete. */
  COMMITTED = 'COMMITTED',
  /** Batch was interrupted; can be resumed from last checkpoint. */
  INTERRUPTED = 'INTERRUPTED',
  /** All rows were invalid or quarantined; nothing committed. */
  REJECTED = 'REJECTED',
  /** Duplicate file submission — no rows processed. */
  DEDUPLICATED = 'DEDUPLICATED',
}

/** Structured quarantine reason codes for actionable data quality feedback. */
export enum QuarantineReasonCode {
  SCHEMA_VIOLATION = 'SCHEMA_VIOLATION',
  BUSINESS_RULE_VIOLATION = 'BUSINESS_RULE_VIOLATION',
  DUPLICATE_IN_BATCH = 'DUPLICATE_IN_BATCH',
  DUPLICATE_IN_DB = 'DUPLICATE_IN_DB',
  COMMIT_ERROR = 'COMMIT_ERROR',
  ANOMALOUS_VALUE = 'ANOMALOUS_VALUE',
}
