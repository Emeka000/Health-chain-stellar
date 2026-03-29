export enum ReconciliationRunStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum MismatchType {
  AMOUNT = 'amount',
  STATUS = 'status',
  PARTIES = 'parties',
  TIMESTAMP = 'timestamp',
  PROOF_REF = 'proof_ref',
  MISSING_ON_CHAIN = 'missing_on_chain',
  MISSING_OFF_CHAIN = 'missing_off_chain',
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
