import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Tracks the attribution graph connecting pledges/donations to concrete outcomes
 */
@Entity('donation_attributions')
@Index(['correlationId'])
@Index(['donorId'])
@Index(['pledgeId'])
@Index(['donationId'])
export class DonationAttributionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Unique correlation ID linking related events across the attribution chain */
  @Column({ name: 'correlation_id', type: 'varchar', length: 64 })
  correlationId: string;

  /** Donor identifier (anonymized) */
  @Column({ name: 'donor_id', type: 'varchar', nullable: true })
  donorId: string | null;

  /** Reference to pledge if this is a recurring donation */
  @Column({ name: 'pledge_id', type: 'uuid', nullable: true })
  pledgeId: string | null;

  /** Reference to one-time donation */
  @Column({ name: 'donation_id', type: 'uuid', nullable: true })
  donationId: string | null;

  /** Blood unit ID that was allocated from this donation */
  @Column({ name: 'blood_unit_id', type: 'uuid', nullable: true })
  bloodUnitId: string | null;

  /** Order ID that fulfilled the request */
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  /** Beneficiary organization/hospital ID */
  @Column({ name: 'beneficiary_id', type: 'varchar', nullable: true })
  beneficiaryId: string | null;

  /** Attribution score (0-1) for partial fulfillment scenarios */
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 1.0 })
  attributionScore: number;

  /** Confidence indicator for incomplete lineage (0-1) */
  @Column({ type: 'decimal', precision: 5, scale: 4, default: 1.0 })
  confidenceScore: number;

  /** Lineage path showing the full chain of events */
  @Column({ type: 'jsonb' })
  lineagePath: {
    eventType: string;
    eventId: string;
    timestamp: string;
    metadata?: Record<string, any>;
  }[];

  /** Indicates if this is a pooled donation (multiple donors contributing) */
  @Column({ name: 'is_pooled', type: 'boolean', default: false })
  isPooled: boolean;

  /** For pooled donations, the contribution percentage */
  @Column({ name: 'pool_contribution_pct', type: 'decimal', precision: 5, scale: 2, nullable: true })
  poolContributionPct: number | null;

  /** Outcome event reference (delivery confirmation, patient treatment, etc.) */
  @Column({ name: 'outcome_event_id', type: 'varchar', nullable: true })
  outcomeEventId: string | null;

  /** Outcome type */
  @Column({ name: 'outcome_type', type: 'varchar', length: 50, nullable: true })
  outcomeType: string | null;

  /** Metadata for additional context */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
