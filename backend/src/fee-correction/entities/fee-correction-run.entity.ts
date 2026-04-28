import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FeeCorrectionRunStatus } from '../enums/fee-correction.enum';

/**
 * Tracks a batch retroactive fee correction job.
 *
 * Design principles:
 *  - Idempotent: identified by idempotency_key; re-running with the same key
 *    resumes from the cursor rather than restarting.
 *  - Approval-gated: execution is blocked until an ApprovalRequest is APPROVED.
 *  - Resumable: cursor_order_id records the last processed order so partial
 *    failures can be continued without reprocessing completed entries.
 */
@Entity('fee_correction_runs')
@Index('IDX_FEE_CORRECTION_RUNS_STATUS', ['status'])
@Index('IDX_FEE_CORRECTION_RUNS_POLICY', ['policySnapshotId'])
export class FeeCorrectionRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Caller-supplied idempotency key.
   * Prevents duplicate runs for the same correction intent.
   */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, unique: true })
  idempotencyKey: string;

  @Column({
    type: 'varchar',
    length: 32,
    default: FeeCorrectionRunStatus.PENDING_APPROVAL,
  })
  status: FeeCorrectionRunStatus;

  /**
   * The fee policy ID that contained the bug.
   * Orders that were computed under this policy are the correction targets.
   */
  @Column({ name: 'policy_snapshot_id', type: 'uuid' })
  policySnapshotId: string;

  /**
   * The replacement/corrected fee policy ID to recompute fees under.
   */
  @Column({ name: 'corrected_policy_id', type: 'uuid' })
  correctedPolicyId: string;

  /** Start of the affected order window (inclusive). */
  @Column({ name: 'affected_from', type: 'timestamptz' })
  affectedFrom: Date;

  /** End of the affected order window (inclusive). */
  @Column({ name: 'affected_to', type: 'timestamptz' })
  affectedTo: Date;

  /** Total number of orders discovered in the affected window. */
  @Column({ name: 'total_affected', type: 'int', default: 0 })
  totalAffected: number;

  /** Number of orders processed so far (for progress tracking). */
  @Column({ name: 'total_processed', type: 'int', default: 0 })
  totalProcessed: number;

  /**
   * Resume cursor: UUID of the last order that was successfully processed.
   * On resume, the query starts AFTER this order (ordered by created_at ASC, id ASC).
   */
  @Column({ name: 'cursor_order_id', type: 'uuid', nullable: true })
  cursorOrderId: string | null;

  /**
   * Linked ApprovalRequest ID.
   * Execution is blocked until this request reaches APPROVED status.
   */
  @Column({ name: 'approval_request_id', type: 'uuid', nullable: true })
  approvalRequestId: string | null;

  /** User ID or system identifier that initiated the run. */
  @Column({ name: 'initiated_by', type: 'varchar', length: 120 })
  initiatedBy: string;

  /** User ID that executed the run after approval. */
  @Column({ name: 'executed_by', type: 'varchar', length: 120, nullable: true })
  executedBy: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
