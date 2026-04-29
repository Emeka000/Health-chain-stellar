/**
 * Full verification lifecycle state machine.
 *
 *   PENDING_VERIFICATION
 *     → APPROVED          (admin approves)
 *     → REJECTED          (admin rejects)
 *   APPROVED
 *     → SUSPENDED         (admin suspends — grace period starts)
 *     → UNVERIFIED        (admin revokes — immediate or after grace)
 *   SUSPENDED
 *     → APPROVED          (admin reinstates)
 *     → UNVERIFIED        (grace period expires without reinstatement)
 *   REJECTED
 *     → PENDING_VERIFICATION (re-application)
 *   UNVERIFIED
 *     → PENDING_VERIFICATION (re-application)
 */
export enum OrgLifecycleStatus {
  PENDING_VERIFICATION = 'pending_verification',
  APPROVED = 'approved',
  SUSPENDED = 'suspended',
  UNVERIFIED = 'unverified',
  REJECTED = 'rejected',
}

/** Allowed forward transitions — enforced by the lifecycle guard */
export const ALLOWED_TRANSITIONS: Record<OrgLifecycleStatus, OrgLifecycleStatus[]> = {
  [OrgLifecycleStatus.PENDING_VERIFICATION]: [
    OrgLifecycleStatus.APPROVED,
    OrgLifecycleStatus.REJECTED,
  ],
  [OrgLifecycleStatus.APPROVED]: [
    OrgLifecycleStatus.SUSPENDED,
    OrgLifecycleStatus.UNVERIFIED,
  ],
  [OrgLifecycleStatus.SUSPENDED]: [
    OrgLifecycleStatus.APPROVED,
    OrgLifecycleStatus.UNVERIFIED,
  ],
  [OrgLifecycleStatus.REJECTED]: [
    OrgLifecycleStatus.PENDING_VERIFICATION,
  ],
  [OrgLifecycleStatus.UNVERIFIED]: [
    OrgLifecycleStatus.PENDING_VERIFICATION,
  ],
};

/** Structured reason taxonomy for all lifecycle change actions */
export enum VerificationChangeReason {
  // Approval reasons
  DOCUMENTS_VERIFIED = 'documents_verified',
  COMPLIANCE_CONFIRMED = 'compliance_confirmed',
  // Rejection reasons
  INCOMPLETE_DOCUMENTS = 'incomplete_documents',
  LICENSE_INVALID = 'license_invalid',
  FAILED_COMPLIANCE = 'failed_compliance',
  // Suspension reasons
  COMPLIANCE_BREACH = 'compliance_breach',
  FRAUD_INVESTIGATION = 'fraud_investigation',
  REGULATORY_HOLD = 'regulatory_hold',
  SAFETY_CONCERN = 'safety_concern',
  // Reinstatement reasons
  INVESTIGATION_CLEARED = 'investigation_cleared',
  COMPLIANCE_RESTORED = 'compliance_restored',
  // Unverification reasons
  LICENSE_EXPIRED = 'license_expired',
  REPEATED_VIOLATIONS = 'repeated_violations',
  VOLUNTARY_EXIT = 'voluntary_exit',
  GRACE_PERIOD_EXPIRED = 'grace_period_expired',
  // Re-application
  REAPPLICATION = 'reapplication',
}

/**
 * How in-flight operations (PENDING/CONFIRMED orders) are handled
 * when an org transitions to SUSPENDED or UNVERIFIED.
 */
export enum InFlightConflictPolicy {
  /** Allow in-flight ops to complete; block new ones */
  DRAIN = 'drain',
  /** Cancel all in-flight ops immediately */
  CANCEL_ALL = 'cancel_all',
  /** Flag in-flight ops for manual review */
  FLAG_FOR_REVIEW = 'flag_for_review',
}

/** Staged restriction levels applied during grace period */
export enum RestrictionLevel {
  NONE = 'none',
  /** New orders blocked; existing orders continue */
  NEW_ORDERS_BLOCKED = 'new_orders_blocked',
  /** All operations blocked */
  FULLY_RESTRICTED = 'fully_restricted',
}
