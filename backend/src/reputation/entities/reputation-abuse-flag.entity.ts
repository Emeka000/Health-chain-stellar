import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

export enum AbuseFlag {
  COLLUSION_CLUSTER = 'collusion_cluster',
  SYBIL_SUSPECTED = 'sybil_suspected',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  HIGH_IMPACT_UNVERIFIED = 'high_impact_unverified',
}

export enum ModerationStatus {
  PENDING = 'pending',
  UNDER_REVIEW = 'under_review',
  CLEARED = 'cleared',
  REVERSED = 'reversed',
}

/**
 * Records a suspicious reputation event pending moderation.
 * The associated history entry is held in PENDING state until cleared or reversed.
 */
@Entity('reputation_abuse_flags')
@Index(['riderId'])
@Index(['status'])
export class ReputationAbuseFlagEntity extends BaseEntity {
  @Column({ name: 'rider_id' })
  riderId: string;

  /** The reputation_history entry that triggered this flag */
  @Column({ name: 'history_id', nullable: true })
  historyId: string | null;

  @Column({ name: 'flag', type: 'varchar', length: 64 })
  flag: AbuseFlag;

  @Column({ name: 'status', type: 'varchar', length: 32, default: ModerationStatus.PENDING })
  status: ModerationStatus;

  /** Serialised evidence snapshot (e.g. cluster members, rate-limit window counts) */
  @Column({ name: 'evidence', type: 'jsonb', nullable: true })
  evidence: Record<string, unknown> | null;

  /** Score delta that was withheld pending review */
  @Column({ name: 'withheld_delta', type: 'float', default: 0 })
  withheldDelta: number;

  @Column({ name: 'reviewed_by', nullable: true })
  reviewedBy: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote: string | null;
}
