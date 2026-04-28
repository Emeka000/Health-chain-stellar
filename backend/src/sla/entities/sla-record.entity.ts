import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SlaStage } from '../enums/sla-stage.enum';

/**
 * One row per (order, stage). Tracks clock start/end, paused intervals,
 * the SLA budget, and whether the stage breached.
 */
@Entity('sla_records')
@Index(['orderId', 'stage'], { unique: true })
@Index(['hospitalId'])
@Index(['bloodBankId'])
@Index(['riderId'])
@Index(['urgencyTier'])
export class SlaRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'hospital_id' })
  hospitalId: string;

  @Column({ name: 'blood_bank_id', nullable: true, type: 'varchar' })
  bloodBankId: string | null;

  @Column({ name: 'rider_id', nullable: true, type: 'varchar' })
  riderId: string | null;

  @Column({ name: 'urgency_tier', default: 'STANDARD' })
  urgencyTier: string;

  @Column({ type: 'enum', enum: SlaStage })
  stage: SlaStage;

  /** Wall-clock when this stage started */
  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  /** Wall-clock when this stage completed (null = still open) */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  /** Total seconds the clock was paused (external-dependency holds) */
  @Column({ name: 'paused_seconds', type: 'int', default: 0 })
  pausedSeconds: number;

  /** Ordered list of [pausedAt, resumedAt] ISO pairs */
  @Column({ name: 'pause_intervals', type: 'jsonb', default: [] })
  pauseIntervals: Array<{ pausedAt: string; resumedAt: string | null }>;

  /** SLA budget in seconds for this stage + urgency tier */
  @Column({ name: 'budget_seconds', type: 'int' })
  budgetSeconds: number;

  /** Elapsed active seconds at completion (null = still open) */
  @Column({ name: 'elapsed_seconds', type: 'int', nullable: true })
  elapsedSeconds: number | null;

  @Column({ name: 'breached', default: false })
  breached: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
