import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

export enum SagaState {
  STARTED = 'STARTED',
  INVENTORY_RESERVED = 'INVENTORY_RESERVED',
  APPROVED = 'APPROVED',
  DISPATCHED = 'DISPATCHED',
  IN_TRANSIT = 'IN_TRANSIT',
  SETTLED = 'SETTLED',
  COMPENSATING = 'COMPENSATING',
  CANCELLED = 'CANCELLED',
  COMPENSATION_FAILED = 'COMPENSATION_FAILED',
}

export enum SagaCompensationReason {
  INVENTORY_UNAVAILABLE = 'INVENTORY_UNAVAILABLE',
  APPROVAL_REJECTED = 'APPROVAL_REJECTED',
  DISPATCH_FAILED = 'DISPATCH_FAILED',
  DELIVERY_FAILED = 'DELIVERY_FAILED',
  TIMEOUT = 'TIMEOUT',
  MANUAL_CANCEL = 'MANUAL_CANCEL',
}

/**
 * Persistent saga state for blood request fulfillment.
 * Each instance is resumable after service restart.
 * VersionColumn prevents concurrent step execution.
 */
@Entity('blood_request_sagas')
@Index('idx_saga_request_id', ['requestId'], { unique: true })
@Index('idx_saga_state', ['state'])
@Index('idx_saga_correlation_id', ['correlationId'])
@Index('idx_saga_timeout_at', ['timeoutAt'])
export class BloodRequestSagaEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id', type: 'uuid', unique: true })
  requestId: string;

  /** Propagated to all participating module events and logs */
  @Column({ name: 'correlation_id', type: 'varchar', length: 128 })
  correlationId: string;

  @Column({ type: 'enum', enum: SagaState, default: SagaState.STARTED })
  state: SagaState;

  /** Applied compensation steps — idempotent retry guard */
  @Column({ name: 'compensation_log', type: 'jsonb', default: [] })
  compensationLog: Array<{ step: string; appliedAt: string; success: boolean }>;

  @Column({
    name: 'compensation_reason',
    type: 'enum',
    enum: SagaCompensationReason,
    nullable: true,
  })
  compensationReason: SagaCompensationReason | null;

  /** Arbitrary context carried between steps (reserved item ids, etc.) */
  @Column({ name: 'context', type: 'jsonb', default: {} })
  context: Record<string, unknown>;

  /** Absolute deadline — exceeded sagas are escalated */
  @Column({ name: 'timeout_at', type: 'timestamptz', nullable: true })
  timeoutAt: Date | null;

  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
