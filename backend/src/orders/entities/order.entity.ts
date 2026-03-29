import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
  Index,
} from 'typeorm';

import { OrderStatus } from '../enums/order-status.enum';
import { EscalationTier } from '../../escalation/enums/escalation-tier.enum';

@Entity('orders')
@Index('IDX_ORDERS_HOSPITAL_ID', ['hospitalId'])
@Index('IDX_ORDERS_BLOOD_BANK_ID', ['bloodBankId'])
@Index('IDX_ORDERS_STATUS', ['status'])
@Index('IDX_ORDERS_CREATED_AT', ['createdAt'])
export class OrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'hospital_id' })
  hospitalId: string;

  @Column({ name: 'blood_type' })
  bloodType: string;

  @Column({ name: 'blood_bank_id', type: 'varchar', nullable: true })
  bloodBankId: string | null;

  @Column()
  quantity: number;

  @Column({ name: 'delivery_address' })
  deliveryAddress: string;

  @Column({
    type: 'simple-enum',
    enum: OrderStatus,
    default: OrderStatus.PENDING,
  })
  status: OrderStatus;

  @Column({ name: 'rider_id', nullable: true, type: 'varchar' })
  riderId: string | null;

  @Column({ name: 'dispute_id', nullable: true, type: 'varchar' })
  disputeId: string | null;

  @Column({ name: 'dispute_reason', nullable: true, type: 'text' })
  disputeReason: string | null;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  feeBreakdown: {
    deliveryFee: number;
    platformFee: number;
    performanceFee: number;
    fixedFee: number;
    totalFee: number;
    baseAmount: number;
    appliedPolicyId: string;
    auditHash: string;
  } | null;

  @Column({ name: 'applied_policy_id', type: 'uuid', nullable: true })
  appliedPolicyId: string | null;

  @Column({
    name: 'escalation_tier',
    type: 'varchar',
    length: 16,
    default: EscalationTier.NONE,
  })
  escalationTier: EscalationTier;
}

