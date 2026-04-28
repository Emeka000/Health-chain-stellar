import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { OnboardingStatus, OnboardingStep } from '../enums/onboarding.enum';
import { OrganizationType } from '../../organizations/enums/organization-type.enum';

@Entity('partner_onboardings')
@Index(['status'])
@Index(['submittedBy'])
export class PartnerOnboardingEntity extends BaseEntity {
  @Column({ name: 'submitted_by', type: 'varchar' })
  submittedBy: string;

  @Column({ type: 'enum', enum: OrganizationType })
  orgType: OrganizationType;

  @Column({ type: 'enum', enum: OnboardingStatus, default: OnboardingStatus.DRAFT })
  status: OnboardingStatus;

  @Column({ name: 'current_step', type: 'enum', enum: OnboardingStep, default: OnboardingStep.PROFILE })
  currentStep: OnboardingStep;

  /** Step data stored as JSONB blobs keyed by OnboardingStep */
  @Column({ type: 'jsonb', default: {} })
  data: Record<string, unknown>;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @Column({ name: 'reviewed_by', type: 'varchar', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @Column({ name: 'contract_tx_hash', type: 'varchar', nullable: true })
  contractTxHash: string | null;
}
