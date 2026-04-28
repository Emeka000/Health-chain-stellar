import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum DeadLetterStatus {
  PENDING = 'PENDING',
  REPLAYED = 'REPLAYED',
  DISCARDED = 'DISCARDED',
}

/**
 * Dead-letter store for outbox events that exhausted all retry attempts.
 * Operators can inspect, replay, or discard entries via the API.
 */
@Entity('outbox_dead_letters')
@Index('idx_dead_letter_status', ['status'])
@Index('idx_dead_letter_event_type', ['eventType'])
@Index('idx_dead_letter_correlation', ['correlationId'])
export class OutboxDeadLetterEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Original outbox event id */
  @Column({ name: 'outbox_event_id', type: 'uuid' })
  outboxEventId: string;

  @Column({ name: 'aggregate_id', type: 'varchar', length: 128, nullable: true })
  aggregateId: string | null;

  @Column({ name: 'aggregate_type', type: 'varchar', length: 100, nullable: true })
  aggregateType: string | null;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  @Column({ name: 'event_version', type: 'int', default: 1 })
  eventVersion: number;

  @Column({ name: 'correlation_id', type: 'varchar', length: 128, nullable: true })
  correlationId: string | null;

  /** Full event payload snapshot */
  @Column({ name: 'payload', type: 'jsonb' })
  payload: Record<string, unknown>;

  /** Total attempts before dead-lettering */
  @Column({ name: 'attempt_count', type: 'int' })
  attemptCount: number;

  /** Last error that caused dead-lettering */
  @Column({ name: 'last_error', type: 'text' })
  lastError: string;

  @Column({
    type: 'enum',
    enum: DeadLetterStatus,
    default: DeadLetterStatus.PENDING,
  })
  status: DeadLetterStatus;

  /** Operator notes when replaying or discarding */
  @Column({ name: 'operator_notes', type: 'text', nullable: true })
  operatorNotes: string | null;

  @CreateDateColumn({ name: 'dead_lettered_at' })
  deadLetteredAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
