import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  UpdateDateColumn,
} from 'typeorm';
import { EscalationTier } from '../enums/escalation-tier.enum';

@Entity('escalations')
@Index('idx_escalations_request', ['requestId'])
@Index('idx_escalations_tier', ['tier'])
@Index('idx_escalations_acknowledged', ['acknowledgedAt'])
export class EscalationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id', type: 'varchar', length: 64 })
  requestId: string;

  @Column({ name: 'order_id', type: 'varchar', length: 64, nullable: true })
  orderId: string | null;

  @Column({ name: 'hospital_id', type: 'varchar', length: 64 })
  hospitalId: string;

  @Column({ type: 'enum', enum: EscalationTier })
  tier: EscalationTier;

  @Column({ name: 'sla_deadline_ms', type: 'bigint' })
  slaDeadlineMs: number;

  @Column({ name: 'rider_id', type: 'varchar', length: 64, nullable: true })
  riderId: string | null;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ name: 'acknowledged_by', type: 'varchar', length: 64, nullable: true })
  acknowledgedBy: string | null;

  @Column({ name: 'policy_chain', type: 'jsonb', default: () => "'[]'" })
  policyChain: Array<{
    level: number;
    targetRole: string;
    timeoutSeconds: number;
    actions: string[];
  }>;

  @Column({ name: 'current_level', type: 'int', default: 1 })
  currentLevel: number;

  @Column({
    name: 'next_escalation_at',
    type: 'timestamptz',
    nullable: true,
  })
  nextEscalationAt: Date | null;

  @Column({ type: 'varchar', length: 24, default: 'OPEN' })
  status: 'OPEN' | 'ACKNOWLEDGED' | 'EXHAUSTED';

  @Column({ name: 'incident_review_id', type: 'uuid', nullable: true })
  incidentReviewId: string | null;

  @Column({ name: 'remediation_task_id', type: 'varchar', length: 128, nullable: true })
  remediationTaskId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
