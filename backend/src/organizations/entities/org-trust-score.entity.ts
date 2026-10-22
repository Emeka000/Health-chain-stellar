import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Per-factor contribution in the score explanation */
export interface TrustFactorContribution {
  factor: string;
  rawValue: number;
  normalizedValue: number;
  weight: number;
  contribution: number;
}

/** Feature snapshot used to reproduce a score update */
export interface TrustFeatureSnapshot {
  fulfillmentRate: number;
  disputeRate: number;
  complianceRate: number;
  avgRating: number;
  reviewCount: number;
  recencyDays: number;
  suspiciousRatingFlag: boolean;
  capturedAt: string;
}

@Entity('org_trust_scores')
@Index('idx_org_trust_org_id', ['organizationId'])
export class OrgTrustScoreEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid', unique: true })
  organizationId: string;

  /** Current trust score [0, 100] */
  @Column({ name: 'score', type: 'float', default: 0 })
  score: number;

  /** Version incremented on each score update */
  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  /** Feature snapshot used to compute the current score */
  @Column({ name: 'feature_snapshot', type: 'jsonb', nullable: true })
  featureSnapshot: TrustFeatureSnapshot | null;

  /** Per-factor explanation of the current score */
  @Column({ name: 'explanation', type: 'jsonb', nullable: true })
  explanation: TrustFactorContribution[] | null;

  /** Anti-gaming flag: true if suspicious rating patterns detected */
  @Column({ name: 'suspicious_rating_flag', type: 'boolean', default: false })
  suspiciousRatingFlag: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
