import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { RolloutStatus } from '../enums/rollout-status.enum';
import { PolicyVersionEntity } from './policy-version.entity';

@Entity('policy_rollouts')
@Index(['policyVersionId'])
@Index(['status'])
export class PolicyRolloutEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'policy_version_id' })
  policyVersionId: string;

  @ManyToOne(() => PolicyVersionEntity, { eager: false })
  @JoinColumn({ name: 'policy_version_id' })
  policyVersion: PolicyVersionEntity;

  /**
   * Percentage of traffic/users currently receiving this policy version.
   * Starts at canaryPercent, expands in steps, reaches 100 on full rollout.
   */
  @Column({ name: 'current_percent', type: 'int', default: 0 })
  currentPercent: number;

  /** Initial canary percentage (e.g. 5) */
  @Column({ name: 'canary_percent', type: 'int', default: 5 })
  canaryPercent: number;

  /** Step size for each expansion (e.g. 25 → 5 → 30 → 55 → 80 → 100) */
  @Column({ name: 'step_percent', type: 'int', default: 25 })
  stepPercent: number;

  @Column({ type: 'enum', enum: RolloutStatus, default: RolloutStatus.PENDING })
  status: RolloutStatus;

  /** Canary evaluation window in minutes */
  @Column({ name: 'canary_window_minutes', type: 'int', default: 30 })
  canaryWindowMinutes: number;

  /** Error-rate threshold above which canary auto-aborts (0–1) */
  @Column({ name: 'error_rate_threshold', type: 'float', default: 0.05 })
  errorRateThreshold: number;

  /** Snapshot of canary metrics at evaluation time */
  @Column({ name: 'canary_metrics', type: 'jsonb', nullable: true })
  canaryMetrics: Record<string, any> | null;

  /** Evaluation result: passed | failed | pending */
  @Column({ name: 'canary_evaluation', nullable: true })
  canaryEvaluation: 'passed' | 'failed' | 'pending' | null;

  @Column({ name: 'started_by' })
  startedBy: string;

  @Column({ name: 'rolled_back_by', nullable: true })
  rolledBackBy: string | null;

  @Column({ name: 'rollback_reason', type: 'text', nullable: true })
  rollbackReason: string | null;

  @Column({ name: 'rollback_to_version_id', nullable: true })
  rollbackToVersionId: string | null;

  @Column({ name: 'canary_started_at', type: 'timestamptz', nullable: true })
  canaryStartedAt: Date | null;

  @Column({ name: 'full_rollout_at', type: 'timestamptz', nullable: true })
  fullRolloutAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
