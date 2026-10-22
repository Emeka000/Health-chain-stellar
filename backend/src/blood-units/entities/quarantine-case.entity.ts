import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  QuarantineDisposition,
  QuarantineReasonCode,
  QuarantineReviewState,
  QuarantineTriggerSource,
} from '../enums/quarantine.enums';

@Entity('blood_unit_quarantine_cases')
@Index('idx_quarantine_case_unit_id', ['bloodUnitId'])
@Index('idx_quarantine_case_active', ['active'])
@Index('idx_quarantine_case_review_state', ['reviewState'])
export class QuarantineCase extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'blood_unit_id', type: 'varchar' })
  bloodUnitId: string;

  @Column({
    name: 'trigger_source',
    type: 'enum',
    enum: QuarantineTriggerSource,
  })
  triggerSource: QuarantineTriggerSource;

  @Column({
    name: 'reason_code',
    type: 'enum',
    enum: QuarantineReasonCode,
  })
  reasonCode: QuarantineReasonCode;

  @Column({ type: 'varchar', nullable: true })
  reason: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({
    name: 'review_state',
    type: 'enum',
    enum: QuarantineReviewState,
    default: QuarantineReviewState.PENDING,
  })
  reviewState: QuarantineReviewState;

  @Column({ name: 'reviewer_assigned_to', type: 'varchar', nullable: true })
  reviewerAssignedTo: string | null;

  @Column({ name: 'reviewed_by', type: 'varchar', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt: Date | null;

  @Column({
    name: 'final_disposition',
    type: 'enum',
    enum: QuarantineDisposition,
    nullable: true,
  })
  finalDisposition: QuarantineDisposition | null;

  @Column({ name: 'disposition_notes', type: 'text', nullable: true })
  dispositionNotes: string | null;

  @Column({ name: 'disposition_at', type: 'timestamp', nullable: true })
  dispositionAt: Date | null;

  @Column({ name: 'policy_reference', type: 'varchar', nullable: true })
  policyReference: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  evidence: Array<{
    type: string;
    fileId: string;
    description?: string;
  }> | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'created_by', type: 'varchar', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
