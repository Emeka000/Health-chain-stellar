import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  AnomalyType,
  AnomalySeverity,
  AnomalyStatus,
} from '../enums/anomaly-type.enum';

@Entity('anomaly_incidents')
export class AnomalyIncidentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: AnomalyType })
  type: AnomalyType;

  @Column({ type: 'enum', enum: AnomalySeverity })
  severity: AnomalySeverity;

  @Column({
    type: 'enum',
    enum: AnomalyStatus,
    default: AnomalyStatus.OPEN,
  })
  status: AnomalyStatus;

  @Column({ type: 'text' })
  description: string;

  /** Related entity IDs for cross-linking */
  @Column({ name: 'order_id', type: 'varchar', nullable: true })
  orderId: string | null;

  @Column({ name: 'rider_id', type: 'varchar', nullable: true })
  riderId: string | null;

  @Column({ name: 'hospital_id', type: 'varchar', nullable: true })
  hospitalId: string | null;

  @Column({ name: 'blood_request_id', type: 'varchar', nullable: true })
  bloodRequestId: string | null;

  @Column({ name: 'policy_version_ref', type: 'varchar', nullable: true })
  policyVersionRef: string | null;

  /** Model/version metadata for provenance tracking */
  @Column({ name: 'model_version', type: 'varchar', nullable: true })
  modelVersion: string | null;

  /** Raw evidence snapshot */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'review_notes', type: 'text', nullable: true })
  reviewNotes: string | null;

  @Column({ name: 'reviewed_by', type: 'varchar', nullable: true })
  reviewedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
