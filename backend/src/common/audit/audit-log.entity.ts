import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Insert-only audit log for security-sensitive mutations.
 * No UPDATE or DELETE is permitted at the ORM level — enforced by
 * AuditLogService which only exposes `insert()`.
 *
 * Enhanced with correlation ID, category, severity, and additional metadata
 * for comprehensive audit trail and compliance requirements.
 */
@Entity('audit_logs')
@Index('idx_audit_logs_actor', ['actorId'])
@Index('idx_audit_logs_resource', ['resourceType', 'resourceId'])
@Index('idx_audit_logs_timestamp', ['timestamp'])
@Index('idx_audit_logs_correlation', ['correlationId'])
@Index('idx_audit_logs_category', ['category'])
@Index('idx_audit_logs_severity', ['severity'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** User who performed the action. */
  @Column({ name: 'actor_id', type: 'varchar', length: 64 })
  actorId: string;

  /** Role of the actor at the time of the action. */
  @Column({ name: 'actor_role', type: 'varchar', length: 64 })
  actorRole: string;

  /** Human-readable action label, e.g. "blood-unit.status-changed". */
  @Column({ type: 'varchar', length: 128 })
  action: string;

  /** Audit category (authentication, financial, privileged_access, etc.) */
  @Column({ type: 'varchar', length: 64, nullable: true })
  category: string | null;

  /** Severity level (critical, high, medium, low) */
  @Column({ type: 'varchar', length: 32, nullable: true })
  severity: string | null;

  /** Entity type, e.g. "BloodUnit", "Dispute", "User", "Order". */
  @Column({ name: 'resource_type', type: 'varchar', length: 64 })
  resourceType: string;

  /** Primary key of the affected resource. */
  @Column({ name: 'resource_id', type: 'varchar', length: 64 })
  resourceId: string;

  /** Snapshot of the resource state before the mutation. */
  @Column({ name: 'previous_value', type: 'jsonb', nullable: true })
  previousValue: Record<string, unknown> | null;

  /** Snapshot of the resource state after the mutation. */
  @Column({ name: 'next_value', type: 'jsonb', nullable: true })
  nextValue: Record<string, unknown> | null;

  /** IP address of the originating request. */
  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  /** User agent string from the request. */
  @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
  userAgent: string | null;

  /** Correlation ID for tracing related operations across services. */
  @Column({
    name: 'correlation_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  correlationId: string | null;

  /** Additional context metadata (e.g., reason, comment, geo location). */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'timestamp' })
  timestamp: Date;
}
