import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { DisputeOutcome, DisputeReasonTaxonomy, DisputeSeverity, DisputeStatus } from '../enums/dispute.enum';

@Entity('disputes')
@Index(['orderId'])
@Index(['status'])
@Index(['status', 'createdAt'])
export class DisputeEntity extends BaseEntity {
  @Column({ name: 'order_id', nullable: true, type: 'varchar' })
  orderId: string | null;

  @Column({ name: 'payment_id', nullable: true, type: 'varchar' })
  paymentId: string | null;

  @Column({ type: 'enum', enum: DisputeStatus, default: DisputeStatus.OPEN })
  status: DisputeStatus;

  @Column({ type: 'enum', enum: DisputeSeverity, default: DisputeSeverity.MEDIUM })
  severity: DisputeSeverity;

  @Column({ type: 'enum', enum: DisputeReasonTaxonomy })
  reason: DisputeReasonTaxonomy;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'opened_by' })
  openedBy: string;

  @Column({ name: 'assigned_to', nullable: true, type: 'varchar' })
  assignedTo: string | null;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes: string | null;

  /** Structured outcome recorded by the arbitrator (#585). */
  @Column({ name: 'outcome', type: 'enum', enum: DisputeOutcome, nullable: true })
  outcome: DisputeOutcome | null;

  /** Arbitrator identity for traceability (#585). */
  @Column({ name: 'resolved_by', nullable: true, type: 'varchar' })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  /**
   * Evidence chunks: each entry is a URL/reference string.
   * Capped at MAX_EVIDENCE_CHUNKS entries, each at most MAX_EVIDENCE_CHUNK_LENGTH chars.
   * evidenceDigest is the canonical SHA-256 of the sorted, newline-joined chunk list.
   */
  @Column({ name: 'evidence', type: 'jsonb', nullable: true })
  evidence: Array<{ type: string; url: string; addedAt: string }> | null;

  /** Canonical SHA-256 hex digest of the evidence bundle (#585). */
  @Column({ name: 'evidence_digest', type: 'varchar', length: 64, nullable: true })
  evidenceDigest: string | null;

  @Column({ name: 'contract_dispute_id', nullable: true, type: 'varchar' })
  contractDisputeId: string | null;
}
