import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { DeferralReason } from '../enums/eligibility.enum';

@Entity('donor_deferrals')
@Index(['donorId', 'createdAt'])
export class DonorDeferralEntity extends BaseEntity {
  @Column({ name: 'donor_id' })
  donorId: string;

  @Column({ type: 'enum', enum: DeferralReason })
  reason: DeferralReason;

  @Column({ name: 'deferred_until', type: 'timestamptz', nullable: true })
  deferredUntil: Date | null; // null = permanent

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'created_by', type: 'varchar', nullable: true })
  createdBy: string | null;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  /** Override: approver who authorized this deferral override */
  @Column({ name: 'override_approver_id', type: 'varchar', nullable: true })
  overrideApproverId: string | null;

  /** Override: mandatory reason for the override */
  @Column({ name: 'override_reason', type: 'text', nullable: true })
  overrideReason: string | null;

  /** Rule version that produced this deferral */
  @Column({ name: 'rule_version_id', type: 'varchar', nullable: true })
  ruleVersionId: string | null;
}
