/**
 * Permission scopes for blockchain admin operations.
 * Follows the principle of least privilege — read-only metrics
 * require a lower scope than mutating DLQ operations.
 */
export enum AdminScope {
  READ_METRICS = 'blockchain:read:metrics',
  MANAGE_DLQ = 'blockchain:manage:dlq',
  ADMIN_FULL = 'blockchain:admin:full',
}
