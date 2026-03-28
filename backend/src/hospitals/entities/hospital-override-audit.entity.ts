import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';
import { OverrideReason } from '../enums/override-reason.enum';

@Entity('hospital_override_audits')
@Index('idx_hospital_override_hospital_id', ['hospitalId'])
@Index('idx_hospital_override_order_id', ['orderId'])
@Index('idx_hospital_override_created_at', ['createdAt'])
export class HospitalOverrideAuditEntity extends BaseEntity {
  @Column({ name: 'hospital_id', type: 'uuid' })
  hospitalId: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'blood_request_id', type: 'uuid', nullable: true })
  bloodRequestId: string | null;

  @Column({ name: 'approved_by_user_id', type: 'uuid' })
  approvedByUserId: string;

  @Column({
    name: 'reason',
    type: 'enum',
    enum: OverrideReason,
  })
  reason: OverrideReason;

  @Column({ name: 'reason_notes', type: 'text', nullable: true })
  reasonNotes: string | null;

  /** Snapshot of the constraint that was bypassed */
  @Column({ name: 'bypassed_constraint', type: 'jsonb' })
  bypassedConstraint: Record<string, unknown>;

  /** Projected delivery time that was flagged */
  @Column({
    name: 'projected_delivery_at',
    type: 'timestamptz',
    nullable: true,
  })
  projectedDeliveryAt: Date | null;

  @Column({ name: 'is_emergency', type: 'boolean', default: false })
  isEmergency: boolean;
}
