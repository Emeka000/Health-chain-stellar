import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OutboxEventType {
  ORDER_CREATED = 'ORDER_CREATED',
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_DISPATCHED = 'ORDER_DISPATCHED',
  ORDER_IN_TRANSIT = 'ORDER_IN_TRANSIT',
  ORDER_DELIVERED = 'ORDER_DELIVERED',
  ORDER_CANCELLED = 'ORDER_CANCELLED',
  ORDER_DISPUTED = 'ORDER_DISPUTED',
  ORDER_RESOLVED = 'ORDER_RESOLVED',
  INVENTORY_LOW = 'INVENTORY_LOW',
  NOTIFICATION_SENT = 'NOTIFICATION_SENT',
  BLOCKCHAIN_HOOK = 'BLOCKCHAIN_HOOK',
  BLOOD_REQUEST_CREATED = 'BLOOD_REQUEST_CREATED',
  BLOOD_REQUEST_FULFILLED = 'BLOOD_REQUEST_FULFILLED',
  BLOOD_REQUEST_CANCELLED = 'BLOOD_REQUEST_CANCELLED',
  INVENTORY_RESERVED = 'INVENTORY_RESERVED',
  INVENTORY_RELEASED = 'INVENTORY_RELEASED',
}

export enum OutboxEventStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PUBLISHED = 'PUBLISHED',
  DEAD_LETTERED = 'DEAD_LETTERED',
}

/**
 * Transactional outbox table.
 * Writers insert rows in the same DB transaction as their entity writes.
 * The dispatcher polls PENDING rows, acquires a lease, and delivers them.
 */
@Entity('outbox_events')
@Index('idx_outbox_status_created', ['status', 'createdAt'])
@Index('idx_outbox_aggregate', ['aggregateId', 'aggregateType'])
@Index('idx_outbox_correlation', ['correlationId'])
@Index('idx_outbox_dedup_key', ['dedupKey'], { unique: true })
@Index('idx_outbox_lease_expires', ['leaseExpiresAt'])
// Legacy indexes kept for backward compatibility
@Index('IDX_OUTBOX_PUBLISHED', ['published'])
@Index('IDX_OUTBOX_EVENT_TYPE', ['eventType'])
@Index('IDX_OUTBOX_CREATED_AT', ['createdAt'])
export class OutboxEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ── Domain-event envelope ─────────────────────────────────────────────

  /** Aggregate identifier (e.g. blood request id, order id) */
  @Column({ name: 'aggregate_id', type: 'varchar', length: 128, nullable: true })
  aggregateId: string | null;

  /** Aggregate type (e.g. "BloodRequest", "Order") */
  @Column({ name: 'aggregate_type', type: 'varchar', length: 100, nullable: true })
  aggregateType: string | null;

  /** Normalized event type */
  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: OutboxEventType | string;

  /** Schema version for forward-compatibility */
  @Column({ name: 'event_version', type: 'int', default: 1 })
  eventVersion: number;

  /** Correlation id for distributed tracing across modules */
  @Column({ name: 'correlation_id', type: 'varchar', length: 128, nullable: true })
  correlationId: string | null;

  /** Normalized event payload */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  // ── Delivery state ────────────────────────────────────────────────────

  @Column({
    type: 'enum',
    enum: OutboxEventStatus,
    default: OutboxEventStatus.PENDING,
  })
  status: OutboxEventStatus;

  /** Deduplication key — prevents double-delivery on retry */
  @Column({ name: 'dedup_key', type: 'varchar', length: 128 })
  dedupKey: string;

  /** Dispatcher worker id that holds the current lease */
  @Column({ name: 'lease_holder', type: 'varchar', length: 128, nullable: true })
  leaseHolder: string | null;

  /** Lease expiry — if expired, another worker may claim the event */
  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt: Date | null;

  /** Number of delivery attempts */
  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount: number;

  /** Timestamp of next allowed retry (exponential backoff) */
  @Column({ name: 'next_attempt_at', type: 'timestamptz', nullable: true })
  nextAttemptAt: Date | null;

  /** Last error message */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  // ── Legacy fields (backward compat) ──────────────────────────────────

  @Column({ type: 'boolean', default: false })
  published: boolean;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
