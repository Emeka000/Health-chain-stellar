export enum IncidentReviewStatus {
  OPEN = 'open',
  IN_REVIEW = 'in_review',
  /** Root cause identified; awaiting corrective action completion */
  PENDING_ACTION = 'pending_action',
  /** All corrective actions done; awaiting closure validation */
  PENDING_CLOSURE = 'pending_closure',
  CLOSED = 'closed',
  /** Escalated due to overdue deadline */
  ESCALATED = 'escalated',
}
