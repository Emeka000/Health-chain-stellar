import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum DlqReplayOutcome {
  SUCCESS = 'SUCCESS',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
}

/**
 * Audit trail for DLQ replay operations.
 * Tracks who initiated the replay, when, and the outcome.
 */
@Entity('dlq_replay_audits')
@Index('IDX_DLQ_REPLAY_CREATED', ['createdAt'])
export class DlqReplayAuditEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Actor who initiated the replay (admin user ID or 'system'). */
  @Column({ type: 'varchar', length: 128 })
  actorId: string;

  /** Reason for replay (e.g., 'manual admin retry', 'scheduled recovery'). */
  @Column({ type: 'text' })
  reason: string;

  /** Number of jobs attempted to replay. */
  @Column({ type: 'int', default: 0 })
  jobsAttempted: number;

  /** Number of jobs successfully replayed. */
  @Column({ type: 'int', default: 0 })
  jobsReplayed: number;

  /** Number of jobs that failed to replay. */
  @Column({ type: 'int', default: 0 })
  jobsFailed: number;

  /** Overall outcome of the replay operation. */
  @Column({
    type: 'varchar',
    length: 32,
    default: DlqReplayOutcome.SUCCESS,
  })
  outcome: DlqReplayOutcome;

  /** Optional error details if the replay failed. */
  @Column({ type: 'text', nullable: true })
  errorDetails: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
