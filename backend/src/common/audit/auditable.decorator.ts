import { SetMetadata } from '@nestjs/common';

export const AUDITABLE_KEY = 'auditable';

export interface AuditableOptions {
  action: string;
  resourceType: string;
  /** Path to the resource ID in route params, defaults to 'id'. */
  resourceIdParam?: string;
  /** Additional metadata to include in the audit log */
  metadata?: Record<string, unknown>;
}

/**
 * Mark a controller handler as auditable.
 * The AuditLogInterceptor will capture before/after state and write an audit row.
 *
 * @example
 * @Auditable({ action: 'blood-unit.status-changed', resourceType: 'BloodUnit' })
 * @Patch(':id/status')
 * updateStatus(...) {}
 *
 * @example
 * @Auditable({
 *   action: 'financial.fee-policy.updated',
 *   resourceType: 'FeePolicy',
 *   metadata: { category: 'financial' }
 * })
 * @Put(':id')
 * update(...) {}
 */
export const Auditable = (options: AuditableOptions) =>
  SetMetadata(AUDITABLE_KEY, options);
