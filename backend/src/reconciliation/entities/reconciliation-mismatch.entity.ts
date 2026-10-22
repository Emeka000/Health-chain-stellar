import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import {
  ExceptionCategory,
  MismatchType,
  MismatchSeverity,
  MismatchResolution,
} from '../enums/reconciliation.enum';

@Entity('reconciliation_mismatches')
@Index(['runId'])
@Index(['resolution'])
@Index(['referenceId'])
export class ReconciliationMismatchEntity extends BaseEntity {
  @Column({ name: 'run_id', type: 'uuid' })
  runId: string;

  @Column({ name: 'reference_id', type: 'varchar' })
  referenceId: string;

  @Column({ name: 'reference_type', type: 'varchar' })
  referenceType: string; // 'donation' | 'order' | 'dispute'

  @Column({ type: 'enum', enum: MismatchType })
  type: MismatchType;

  @Column({ type: 'enum', enum: MismatchSeverity, default: MismatchSeverity.MEDIUM })
  severity: MismatchSeverity;

  @Column({ name: 'on_chain_value', type: 'jsonb', nullable: true })
  onChainValue: Record<string, unknown> | null;

  @Column({ name: 'off_chain_value', type: 'jsonb', nullable: true })
  offChainValue: Record<string, unknown> | null;

  @Column({ type: 'enum', enum: MismatchResolution, default: MismatchResolution.PENDING })
  resolution: MismatchResolution;

  @Column({ name: 'resolved_by', type: 'varchar', nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ name: 'resolution_note', type: 'text', nullable: true })
  resolutionNote: string | null;

  /** Classified exception category for guided remediation */
  @Column({
    name: 'exception_category',
    type: 'enum',
    enum: ExceptionCategory,
    nullable: true,
  })
  exceptionCategory: ExceptionCategory | null;

  /** Deterministic ranking score for ambiguous candidate ordering (lower = better match) */
  @Column({ name: 'match_score', type: 'float', nullable: true })
  matchScore: number | null;

  /** Remediation action hint for operators */
  @Column({ name: 'remediation_hint', type: 'text', nullable: true })
  remediationHint: string | null;
}
