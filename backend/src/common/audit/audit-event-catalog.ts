/**
 * Audit Event Catalog
 *
 * Comprehensive catalog of all privileged and financially sensitive operations
 * that require audit logging for compliance, security, and investigation purposes.
 *
 * Each event includes:
 * - action: Unique identifier for the operation
 * - category: Classification (auth, financial, privileged, data)
 * - severity: Impact level (critical, high, medium, low)
 * - description: Human-readable description
 * - requiresBeforeAfter: Whether to capture state deltas
 * - retentionYears: Minimum retention period for compliance
 */

export enum AuditCategory {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  FINANCIAL = 'financial',
  PRIVILEGED_ACCESS = 'privileged_access',
  DATA_MODIFICATION = 'data_modification',
  SYSTEM_CONFIGURATION = 'system_configuration',
  COMPLIANCE = 'compliance',
}

export enum AuditSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

export interface AuditEventDefinition {
  action: string;
  category: AuditCategory;
  severity: AuditSeverity;
  description: string;
  requiresBeforeAfter: boolean;
  retentionYears: number;
}

/**
 * Comprehensive audit event catalog
 */
export const AUDIT_EVENT_CATALOG: Record<string, AuditEventDefinition> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // Authentication & Authorization Events
  // ═══════════════════════════════════════════════════════════════════════════
  'auth.login.success': {
    action: 'auth.login.success',
    category: AuditCategory.AUTHENTICATION,
    severity: AuditSeverity.MEDIUM,
    description: 'User successfully authenticated',
    requiresBeforeAfter: false,
    retentionYears: 7,
  },
  'auth.login.failed': {
    action: 'auth.login.failed',
    category: AuditCategory.AUTHENTICATION,
    severity: AuditSeverity.HIGH,
    description: 'Failed login attempt',
    requiresBeforeAfter: false,
    retentionYears: 7,
  },
  'auth.logout': {
    action: 'auth.logout',
    category: AuditCategory.AUTHENTICATION,
    severity: AuditSeverity.LOW,
    description: 'User logged out',
    requiresBeforeAfter: false,
    retentionYears: 3,
  },
  'auth.session.revoked': {
    action: 'auth.session.revoked',
    category: AuditCategory.AUTHENTICATION,
    severity: AuditSeverity.HIGH,
    description: 'Session revoked by user or admin',
    requiresBeforeAfter: false,
    retentionYears: 7,
  },
  'auth.password.changed': {
    action: 'auth.password.changed',
    category: AuditCategory.AUTHENTICATION,
    severity: AuditSeverity.HIGH,
    description: 'User password changed',
    requiresBeforeAfter: false,
    retentionYears: 7,
  },
  'auth.password.reset': {
    action: 'auth.password.reset',
    category: AuditCategory.AUTHENTICATION,
    severity: AuditSeverity.HIGH,
    description: 'Password reset completed',
    requiresBeforeAfter: false,
    retentionYears: 7,
  },
  'auth.account.unlocked': {
    action: 'auth.account.unlocked',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'Account manually unlocked by admin',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'auth.mfa.enabled': {
    action: 'auth.mfa.enabled',
    category: AuditCategory.AUTHENTICATION,
    severity: AuditSeverity.HIGH,
    description: 'Multi-factor authentication enabled',
    requiresBeforeAfter: false,
    retentionYears: 7,
  },
  'auth.mfa.disabled': {
    action: 'auth.mfa.disabled',
    category: AuditCategory.AUTHENTICATION,
    severity: AuditSeverity.CRITICAL,
    description: 'Multi-factor authentication disabled',
    requiresBeforeAfter: false,
    retentionYears: 10,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // User & Role Management
  // ═══════════════════════════════════════════════════════════════════════════
  'user.created': {
    action: 'user.created',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.HIGH,
    description: 'New user account created',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'user.updated': {
    action: 'user.updated',
    category: AuditCategory.DATA_MODIFICATION,
    severity: AuditSeverity.MEDIUM,
    description: 'User account updated',
    requiresBeforeAfter: true,
    retentionYears: 7,
  },
  'user.deleted': {
    action: 'user.deleted',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'User account deleted',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'user.role.changed': {
    action: 'user.role.changed',
    category: AuditCategory.AUTHORIZATION,
    severity: AuditSeverity.CRITICAL,
    description: 'User role or permissions changed',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'user.sessions.revoked.admin': {
    action: 'user.sessions.revoked.admin',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'All user sessions revoked by admin',
    requiresBeforeAfter: false,
    retentionYears: 10,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Financial Operations
  // ═══════════════════════════════════════════════════════════════════════════
  'financial.fee-policy.created': {
    action: 'financial.fee-policy.created',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Fee policy created',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'financial.fee-policy.updated': {
    action: 'financial.fee-policy.updated',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Fee policy updated',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'financial.fee-policy.deleted': {
    action: 'financial.fee-policy.deleted',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Fee policy deleted',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'financial.reconciliation.triggered': {
    action: 'financial.reconciliation.triggered',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Financial reconciliation run triggered',
    requiresBeforeAfter: false,
    retentionYears: 10,
  },
  'financial.reconciliation.resumed': {
    action: 'financial.reconciliation.resumed',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.HIGH,
    description: 'Financial reconciliation run resumed',
    requiresBeforeAfter: false,
    retentionYears: 10,
  },
  'financial.mismatch.resynced': {
    action: 'financial.mismatch.resynced',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Financial mismatch resynced from blockchain',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'financial.mismatch.dismissed': {
    action: 'financial.mismatch.dismissed',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Financial mismatch dismissed',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'financial.mismatch.manual-resolution': {
    action: 'financial.mismatch.manual-resolution',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Financial mismatch manually resolved',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'financial.payment.submitted': {
    action: 'financial.payment.submitted',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Payment transaction submitted to blockchain',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'financial.payment.settled': {
    action: 'financial.payment.settled',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Payment settled on blockchain',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'financial.donation.confirmed': {
    action: 'financial.donation.confirmed',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.HIGH,
    description: 'Donation payment confirmed',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Blockchain & Smart Contract Operations
  // ═══════════════════════════════════════════════════════════════════════════
  'blockchain.transaction.submitted': {
    action: 'blockchain.transaction.submitted',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Blockchain transaction submitted',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'blockchain.transaction.failed': {
    action: 'blockchain.transaction.failed',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Blockchain transaction failed',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'blockchain.contract.deployed': {
    action: 'blockchain.contract.deployed',
    category: AuditCategory.SYSTEM_CONFIGURATION,
    severity: AuditSeverity.CRITICAL,
    description: 'Smart contract deployed',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Escrow Governance (Multi-Signature Release)
  // ═══════════════════════════════════════════════════════════════════════════
  'escrow.proposal.created': {
    action: 'escrow.proposal.created',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Escrow release proposal created',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'escrow.proposal.approved': {
    action: 'escrow.proposal.approved',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Escrow release proposal reached approval threshold',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'escrow.proposal.rejected': {
    action: 'escrow.proposal.rejected',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Escrow release proposal rejected by a signer',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'escrow.proposal.cancelled': {
    action: 'escrow.proposal.cancelled',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Escrow release proposal cancelled',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'escrow.proposal.expired': {
    action: 'escrow.proposal.expired',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.HIGH,
    description: 'Escrow release proposal expired without reaching threshold',
    requiresBeforeAfter: false,
    retentionYears: 10,
  },
  'escrow.proposal.executed': {
    action: 'escrow.proposal.executed',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Escrow release executed on-chain after approval',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'escrow.proposal.emergency-suspended': {
    action: 'escrow.proposal.emergency-suspended',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Escrow release proposal emergency-suspended by admin',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'escrow.vote.cast': {
    action: 'escrow.vote.cast',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.HIGH,
    description: 'Signer cast a vote on an escrow release proposal',
    requiresBeforeAfter: false,
    retentionYears: 10,
  },
  'escrow.signer.added': {
    action: 'escrow.signer.added',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'New escrow signer registered',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'escrow.signer.revoked': {
    action: 'escrow.signer.revoked',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'Escrow signer permanently revoked',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'escrow.signer.suspended': {
    action: 'escrow.signer.suspended',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'Escrow signer temporarily suspended',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'escrow.signer.reactivated': {
    action: 'escrow.signer.reactivated',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.HIGH,
    description: 'Suspended escrow signer reactivated',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'escrow.threshold-policy.created': {
    action: 'escrow.threshold-policy.created',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Escrow threshold policy created',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'escrow.threshold-policy.deactivated': {
    action: 'escrow.threshold-policy.deactivated',
    category: AuditCategory.FINANCIAL,
    severity: AuditSeverity.CRITICAL,
    description: 'Escrow threshold policy deactivated',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Approval & Dispute Resolution
  // ═══════════════════════════════════════════════════════════════════════════
  'approval.request.approved': {
    action: 'approval.request.approved',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.HIGH,
    description: 'Approval request approved',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'approval.request.rejected': {
    action: 'approval.request.rejected',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.HIGH,
    description: 'Approval request rejected',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'dispute.assigned': {
    action: 'dispute.assigned',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.HIGH,
    description: 'Dispute assigned to resolver',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'dispute.resolved': {
    action: 'dispute.resolved',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'Dispute resolved',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Organization Management
  // ═══════════════════════════════════════════════════════════════════════════
  'organization.approved': {
    action: 'organization.approved',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'Organization approved',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'organization.rejected': {
    action: 'organization.rejected',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.HIGH,
    description: 'Organization rejected',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'organization.verified.blockchain': {
    action: 'organization.verified.blockchain',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'Organization verified on blockchain',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'organization.verification.revoked': {
    action: 'organization.verification.revoked',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'Organization blockchain verification revoked',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Onboarding & Partner Management
  // ═══════════════════════════════════════════════════════════════════════════
  'onboarding.reviewed': {
    action: 'onboarding.reviewed',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.HIGH,
    description: 'Onboarding submission reviewed',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'onboarding.activated': {
    action: 'onboarding.activated',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'Onboarding activated (org created)',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Blood Unit & Inventory Management
  // ═══════════════════════════════════════════════════════════════════════════
  'blood-unit.status.changed': {
    action: 'blood-unit.status.changed',
    category: AuditCategory.DATA_MODIFICATION,
    severity: AuditSeverity.HIGH,
    description: 'Blood unit status changed',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'blood-unit.custody.transferred': {
    action: 'blood-unit.custody.transferred',
    category: AuditCategory.DATA_MODIFICATION,
    severity: AuditSeverity.HIGH,
    description: 'Blood unit custody transferred',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'inventory.alert.dismissed': {
    action: 'inventory.alert.dismissed',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.MEDIUM,
    description: 'Inventory alert dismissed',
    requiresBeforeAfter: true,
    retentionYears: 7,
  },
  'inventory.alert.resolved': {
    action: 'inventory.alert.resolved',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.MEDIUM,
    description: 'Inventory alert resolved',
    requiresBeforeAfter: true,
    retentionYears: 7,
  },
  'inventory.forecast.recalibrated': {
    action: 'inventory.forecast.recalibrated',
    category: AuditCategory.SYSTEM_CONFIGURATION,
    severity: AuditSeverity.HIGH,
    description: 'Inventory forecast model recalibrated',
    requiresBeforeAfter: true,
    retentionYears: 7,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Rider & Dispatch Management
  // ═══════════════════════════════════════════════════════════════════════════
  'rider.verified': {
    action: 'rider.verified',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.HIGH,
    description: 'Rider verified by admin',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'rider.assignment.override': {
    action: 'rider.assignment.override',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.HIGH,
    description: 'Rider assignment manually overridden',
    requiresBeforeAfter: true,
    retentionYears: 7,
  },
  'dispatch.override': {
    action: 'dispatch.override',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.HIGH,
    description: 'Dispatch decision overridden',
    requiresBeforeAfter: true,
    retentionYears: 7,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Donor Eligibility & Deferrals
  // ═══════════════════════════════════════════════════════════════════════════
  'donor.deferral.overridden': {
    action: 'donor.deferral.overridden',
    category: AuditCategory.PRIVILEGED_ACCESS,
    severity: AuditSeverity.CRITICAL,
    description: 'Donor deferral overridden by admin',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'donor.eligibility-rule.created': {
    action: 'donor.eligibility-rule.created',
    category: AuditCategory.SYSTEM_CONFIGURATION,
    severity: AuditSeverity.CRITICAL,
    description: 'Donor eligibility rule version created',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // System Configuration & Administration
  // ═══════════════════════════════════════════════════════════════════════════
  'system.region.created': {
    action: 'system.region.created',
    category: AuditCategory.SYSTEM_CONFIGURATION,
    severity: AuditSeverity.HIGH,
    description: 'Region created',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'system.region.updated': {
    action: 'system.region.updated',
    category: AuditCategory.SYSTEM_CONFIGURATION,
    severity: AuditSeverity.HIGH,
    description: 'Region updated',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'system.region.deactivated': {
    action: 'system.region.deactivated',
    category: AuditCategory.SYSTEM_CONFIGURATION,
    severity: AuditSeverity.CRITICAL,
    description: 'Region deactivated',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'system.surge-rule.updated': {
    action: 'system.surge-rule.updated',
    category: AuditCategory.SYSTEM_CONFIGURATION,
    severity: AuditSeverity.HIGH,
    description: 'Surge pricing rule updated',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Data Retention & Compliance
  // ═══════════════════════════════════════════════════════════════════════════
  'compliance.data.archived': {
    action: 'compliance.data.archived',
    category: AuditCategory.COMPLIANCE,
    severity: AuditSeverity.HIGH,
    description: 'Data archived per retention policy',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'compliance.data.deleted': {
    action: 'compliance.data.deleted',
    category: AuditCategory.COMPLIANCE,
    severity: AuditSeverity.CRITICAL,
    description: 'Data permanently deleted per retention policy',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'compliance.legal-hold.applied': {
    action: 'compliance.legal-hold.applied',
    category: AuditCategory.COMPLIANCE,
    severity: AuditSeverity.CRITICAL,
    description: 'Legal hold applied to data',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'compliance.legal-hold.released': {
    action: 'compliance.legal-hold.released',
    category: AuditCategory.COMPLIANCE,
    severity: AuditSeverity.CRITICAL,
    description: 'Legal hold released',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Incident Review Workflow
  // ═══════════════════════════════════════════════════════════════════════════
  'incident.review.auto-created': {
    action: 'incident.review.auto-created',
    category: AuditCategory.COMPLIANCE,
    severity: AuditSeverity.HIGH,
    description: 'Incident review auto-created from anomaly/SLA/compliance event',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'incident.corrective-action.added': {
    action: 'incident.corrective-action.added',
    category: AuditCategory.COMPLIANCE,
    severity: AuditSeverity.HIGH,
    description: 'Corrective action added to incident review',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'incident.corrective-action.completed': {
    action: 'incident.corrective-action.completed',
    category: AuditCategory.COMPLIANCE,
    severity: AuditSeverity.HIGH,
    description: 'Corrective action marked as completed',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'incident.corrective-action.verified': {
    action: 'incident.corrective-action.verified',
    category: AuditCategory.COMPLIANCE,
    severity: AuditSeverity.HIGH,
    description: 'Corrective action verified by reviewer',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'incident.review.escalated': {
    action: 'incident.review.escalated',
    category: AuditCategory.COMPLIANCE,
    severity: AuditSeverity.CRITICAL,
    description: 'Incident review escalated due to overdue actions',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
  'incident.review.closure-validated': {
    action: 'incident.review.closure-validated',
    category: AuditCategory.COMPLIANCE,
    severity: AuditSeverity.HIGH,
    description: 'Incident review closure validated with all actions completed',
    requiresBeforeAfter: true,
    retentionYears: 10,
  },
};

/**
 * Get audit event definition by action
 */
export function getAuditEventDefinition(
  action: string,
): AuditEventDefinition | undefined {
  return AUDIT_EVENT_CATALOG[action];
}

/**
 * Validate if an action is in the catalog
 */
export function isValidAuditAction(action: string): boolean {
  return action in AUDIT_EVENT_CATALOG;
}

/**
 * Get all audit events by category
 */
export function getAuditEventsByCategory(
  category: AuditCategory,
): AuditEventDefinition[] {
  return Object.values(AUDIT_EVENT_CATALOG).filter(
    (event) => event.category === category,
  );
}

/**
 * Get all critical audit events
 */
export function getCriticalAuditEvents(): AuditEventDefinition[] {
  return Object.values(AUDIT_EVENT_CATALOG).filter(
    (event) => event.severity === AuditSeverity.CRITICAL,
  );
}
