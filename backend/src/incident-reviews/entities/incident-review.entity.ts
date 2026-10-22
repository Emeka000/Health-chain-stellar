import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';

import { IncidentRootCause } from '../enums/incident-root-cause.enum';
import { IncidentReviewStatus } from '../enums/incident-review-status.enum';
import { IncidentSeverity } from '../enums/incident-severity.enum';

@Entity('incident_reviews')
@Index('idx_incident_reviews_order_id', ['orderId'])
@Index('idx_incident_reviews_rider_id', ['riderId'])
@Index('idx_incident_reviews_status', ['status'])
@Index('idx_incident_reviews_root_cause', ['rootCause'])
@Index('idx_incident_reviews_created_at', ['createdAt'])
@Index('idx_incident_reviews_hospital_id', ['hospitalId'])
@Index('idx_incident_reviews_blood_bank_id', ['bloodBankId'])
export class IncidentReviewEntity extends BaseEntity {
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'rider_id', type: 'uuid', nullable: true })
  riderId: string | null;

  @Column({ name: 'hospital_id', type: 'varchar', nullable: true })
  hospitalId: string | null;

  @Column({ name: 'blood_bank_id', type: 'varchar', nullable: true })
  bloodBankId: string | null;

  @Column({ name: 'reported_by_user_id', type: 'uuid' })
  reportedByUserId: string;

  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId: string | null;

  @Column({
    name: 'root_cause',
    type: 'enum',
    enum: IncidentRootCause,
  })
  rootCause: IncidentRootCause;

  @Column({
    name: 'severity',
    type: 'enum',
    enum: IncidentSeverity,
    default: IncidentSeverity.MEDIUM,
  })
  severity: IncidentSeverity;

  @Column({
    name: 'status',
    type: 'enum',
    enum: IncidentReviewStatus,
    default: IncidentReviewStatus.OPEN,
  })
  status: IncidentReviewStatus;

  @Column({ name: 'description', type: 'text' })
  description: string;

  @Column({ name: 'corrective_action', type: 'text', nullable: true })
  correctiveAction: string | null;

  @Column({ name: 'resolution_notes', type: 'text', nullable: true })
  resolutionNotes: string | null;

  /** Whether this incident should feed into scoring adjustments */
  @Column({ name: 'affects_scoring', type: 'boolean', default: true })
  affectsScoring: boolean;

  /** Set to true once reputation/rating adjustments have been applied */
  @Column({ name: 'scoring_applied', type: 'boolean', default: false })
  scoringApplied: boolean;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  // ══════════════════════════════════════════════════════════════════════════
  // Workflow Automation Fields
  // ══════════════════════════════════════════════════════════════════════════

  /** User assigned as owner of this incident review */
  @Column({ name: 'owner_id', type: 'varchar', nullable: true })
  ownerId: string | null;

  /** Deadline for completing the review */
  @Column({ name: 'due_date', type: 'timestamptz', nullable: true })
  dueDate: Date | null;

  /** Linked anomaly incident ID (if auto-created from anomaly) */
  @Column({ name: 'linked_anomaly_id', type: 'varchar', nullable: true })
  linkedAnomalyId: string | null;

  /** Linked SLA breach ID (if auto-created from SLA breach) */
  @Column({ name: 'linked_sla_breach_id', type: 'varchar', nullable: true })
  linkedSlaBreachId: string | null;

  /** Linked order IDs for correlated evidence */
  @Column({ name: 'linked_order_ids', type: 'jsonb', nullable: true })
  linkedOrderIds: string[] | null;

  /** Linked telemetry IDs for correlated evidence */
  @Column({ name: 'linked_telemetry_ids', type: 'jsonb', nullable: true })
  linkedTelemetryIds: string[] | null;

  /** Linked policy IDs for correlated evidence */
  @Column({ name: 'linked_policy_ids', type: 'jsonb', nullable: true })
  linkedPolicyIds: string[] | null;

  /** Escalation level (0 = none, 1+ = escalated) */
  @Column({ name: 'escalation_level', type: 'int', default: 0 })
  escalationLevel: number;

  /** Timestamp when escalated */
  @Column({ name: 'escalated_at', type: 'timestamptz', nullable: true })
  escalatedAt: Date | null;

  /** User who validated closure */
  @Column({ name: 'closure_validated_by', type: 'varchar', nullable: true })
  closureValidatedBy: string | null;

  /** Timestamp when closure was validated */
  @Column({ name: 'closure_validated_at', type: 'timestamptz', nullable: true })
  closureValidatedAt: Date | null;
}
