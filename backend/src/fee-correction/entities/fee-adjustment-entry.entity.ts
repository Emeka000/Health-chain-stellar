import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { FeeCorrectionRunEntity } from './fee-correction-run.entity';
import { FeeAdjustmentEntryStatus } from '../enums/fee-correction.enum';

/**
 * Immutable, additive fee adjustment entry.
 *
 * Design principles:
 *  - Historical records (orders.fee_breakdown) are NEVER mutated.
 *  - Each entry is a signed delta between the original and corrected fee.
 *  - Entries are idempotent per (order_id, correction_run_id).
 *  - The audit_hash is deterministic from inputs, enabling reproducibility checks.
 *  - reconciliation_link ties the entry to the compensating accounting record.
 */
@Entity('fee_adjustment_entries')
@Index('IDX_FEE_ADJ_ORDER_ID', ['orderId'])
@Index('IDX_FEE_ADJ_RUN_ID', ['correctionRunId'])
@Index('IDX_FEE_ADJ_STATUS', ['status'])
@Index('UQ_FEE_ADJ_ORDER_RUN', ['orderId', 'correctionRunId'], { unique: true })
export class FeeAdjustmentEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'correction_run_id', type: 'uuid' })
  correctionRunId: string;

  @ManyToOne(() => FeeCorrectionRunEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'correction_run_id' })
  correctionRun: FeeCorrectionRunEntity;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  /** Policy that was applied when the order was originally placed. */
  @Column({ name: 'original_policy_id', type: 'uuid' })
  originalPolicyId: string;

  /** Policy used to recompute the corrected fee. */
  @Column({ name: 'corrected_policy_id', type: 'uuid' })
  correctedPolicyId: string;

  /**
   * Snapshot of orders.fee_breakdown at correction time.
   * Immutable reference — never updated after creation.
   */
  @Column({ name: 'original_fee_breakdown', type: 'jsonb' })
  originalFeeBreakdown: {
    deliveryFee: number;
    platformFee: number;
    performanceFee: number;
    fixedFee: number;
    totalFee: number;
    baseAmount: number;
    appliedPolicyId: string;
    auditHash: string;
  };

  /** Recomputed fee breakdown under the corrected policy. */
  @Column({ name: 'corrected_fee_breakdown', type: 'jsonb' })
  correctedFeeBreakdown: {
    deliveryFee: number;
    platformFee: number;
    performanceFee: number;
    fixedFee: number;
    totalFee: number;
    baseAmount: number;
    appliedPolicyId: string;
    auditHash: string;
  };

  /** corrected - original (signed). Positive = customer owes more. Negative = refund due. */
  @Column({ name: 'delta_delivery_fee', type: 'numeric', precision: 12, scale: 4 })
  deltaDeliveryFee: number;

  @Column({ name: 'delta_platform_fee', type: 'numeric', precision: 12, scale: 4 })
  deltaPlatformFee: number;

  @Column({ name: 'delta_performance_fee', type: 'numeric', precision: 12, scale: 4 })
  deltaPerformanceFee: number;

  @Column({ name: 'delta_total_fee', type: 'numeric', precision: 12, scale: 4 })
  deltaTotalFee: number;

  /**
   * Reference to the compensating payment/accounting entry.
   * Set after the compensating entry is generated.
   */
  @Column({ name: 'reconciliation_link', type: 'varchar', length: 255, nullable: true })
  reconciliationLink: string | null;

  /**
   * Deterministic hash of (orderId + originalPolicyId + correctedPolicyId + correctedFeeBreakdown).
   * Used to verify reproducibility: re-running the correction with the same inputs
   * must produce the same hash.
   */
  @Column({ name: 'audit_hash', type: 'varchar', length: 128 })
  auditHash: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: FeeAdjustmentEntryStatus.PENDING,
  })
  status: FeeAdjustmentEntryStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
