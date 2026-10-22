import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PoisonEventStatus {
  QUARANTINED = 'QUARANTINED',
  REPLAYED = 'REPLAYED',
  DISCARDED = 'DISCARDED',
}

/**
 * Stores contract events that failed processing (poison events).
 * Operators can inspect and replay or discard them via the API.
 */
@Entity('contract_poison_events')
@Index('idx_poison_events_status', ['status'])
@Index('idx_poison_events_dedup_key', ['dedupKey'])
@Index('idx_poison_events_projection', ['projectionName'])
export class PoisonEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The original dedup key of the failed event */
  @Column({ name: 'dedup_key', type: 'varchar', length: 64 })
  dedupKey: string;

  /** Projection that failed to process this event */
  @Column({ name: 'projection_name', type: 'varchar', length: 100 })
  projectionName: string;

  /** Original event payload snapshot */
  @Column({ name: 'event_snapshot', type: 'jsonb' })
  eventSnapshot: Record<string, unknown>;

  /** Error message from the failed processing attempt */
  @Column({ name: 'error_message', type: 'text' })
  errorMessage: string;

  /** Number of processing attempts before quarantine */
  @Column({ name: 'attempt_count', type: 'int', default: 1 })
  attemptCount: number;

  @Column({
    type: 'enum',
    enum: PoisonEventStatus,
    default: PoisonEventStatus.QUARANTINED,
  })
  status: PoisonEventStatus;

  /** Operator notes when replaying or discarding */
  @Column({ name: 'operator_notes', type: 'text', nullable: true })
  operatorNotes: string | null;

  @CreateDateColumn({ name: 'quarantined_at' })
  quarantinedAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
