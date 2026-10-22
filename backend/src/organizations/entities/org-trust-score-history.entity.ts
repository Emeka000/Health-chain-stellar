import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { TrustFactorContribution, TrustFeatureSnapshot } from './org-trust-score.entity';

/** Immutable record of each trust score update for backtesting and audit */
@Entity('org_trust_score_history')
@Index('idx_org_trust_hist_org_id', ['organizationId'])
export class OrgTrustScoreHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ name: 'version', type: 'int' })
  version: number;

  @Column({ name: 'score', type: 'float' })
  score: number;

  @Column({ name: 'feature_snapshot', type: 'jsonb' })
  featureSnapshot: TrustFeatureSnapshot;

  @Column({ name: 'explanation', type: 'jsonb' })
  explanation: TrustFactorContribution[];

  @Column({ name: 'suspicious_rating_flag', type: 'boolean', default: false })
  suspiciousRatingFlag: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
