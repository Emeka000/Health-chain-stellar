import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export enum ReconciliationSnapshotStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  INTERRUPTED = 'interrupted',
}

/** Persists reconciliation progress for resume-after-interruption support */
@Entity('reconciliation_snapshots')
@Index(['runId'])
@Index(['status'])
export class ReconciliationSnapshotEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @Column({ type: 'enum', enum: ReconciliationSnapshotStatus, default: ReconciliationSnapshotStatus.IN_PROGRESS })
  status: ReconciliationSnapshotStatus;

  /** Last successfully processed reference ID per type (cursor for resume) */
  @Column({ name: 'cursors', type: 'jsonb', default: '{}' })
  cursors: Record<string, string>;

  /** Counts of processed items per reference type */
  @Column({ name: 'processed_counts', type: 'jsonb', default: '{}' })
  processedCounts: Record<string, number>;

  /** Accumulated exception categories */
  @Column({ name: 'exception_summary', type: 'jsonb', default: '{}' })
  exceptionSummary: Record<string, number>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
