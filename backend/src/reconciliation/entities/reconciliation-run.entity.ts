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
}
