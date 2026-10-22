import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { ReconciliationRunStatus } from '../enums/reconciliation.enum';

@Entity('reconciliation_runs')
@Index(['status'])
@Index(['createdAt'])
export class ReconciliationRunEntity extends BaseEntity {
  @Column({ type: 'enum', enum: ReconciliationRunStatus, default: ReconciliationRunStatus.RUNNING })
  status: ReconciliationRunStatus;

  @Column({ name: 'triggered_by', type: 'varchar', nullable: true })
  triggeredBy: string | null;

  @Column({ name: 'total_checked', type: 'int', default: 0 })
  totalChecked: number;

  @Column({ name: 'mismatch_count', type: 'int', default: 0 })
  mismatchCount: number;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  /** Reference to the snapshot used for resume support */
  @Column({ name: 'snapshot_id', type: 'uuid', nullable: true })
  snapshotId: string | null;

  /** Idempotency key — prevents duplicate runs for the same trigger */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true, unique: true })
  idempotencyKey: string | null;
}
