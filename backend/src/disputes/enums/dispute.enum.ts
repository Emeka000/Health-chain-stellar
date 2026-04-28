export enum DisputeStatus {
  OPEN = 'open',
  UNDER_REVIEW = 'under_review',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum DisputeSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export enum DisputeReasonTaxonomy {
  FAILED_DELIVERY = 'failed_delivery',
  TEMPERATURE_EXCURSION = 'temperature_excursion',
  PAYMENT_CONTESTED = 'payment_contested',
  WRONG_ITEM = 'wrong_item',
  DAMAGED_GOODS = 'damaged_goods',
  LATE_DELIVERY = 'late_delivery',
  OTHER = 'other',
}

/** Outcome recorded by the arbitrator when closing a dispute. */
export enum DisputeOutcome {
  PAYER_WIN = 'payer_win',
  PAYEE_WIN = 'payee_win',
  DISMISSED = 'dismissed',
}

/** Maximum number of evidence chunks per dispute. */
export const MAX_EVIDENCE_CHUNKS = 10;
/** Maximum byte length of a single evidence chunk URL/reference. */
export const MAX_EVIDENCE_CHUNK_LENGTH = 512;
