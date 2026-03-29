import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
