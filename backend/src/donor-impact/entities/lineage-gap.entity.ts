import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Records gaps in the attribution lineage chain with confidence indicators
 */
@Entity('lineage_gaps')
@Index(['correlationId'])
export class LineageGapEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'correlation_id', type: 'varchar', length: 64 })
  correlationId: string;

  /** The event type that is missing */
  @Column({ name: 'missing_event_type', type: 'varchar', length: 100 })
  missingEventType: string;

  /** The event that precedes the gap */
  @Column({ name: 'preceding_event_id', type: 'varchar', nullable: true })
  precedingEventId: string | null;

  /** The event that follows the gap (if known) */
  @Column({ name: 'following_event_id', type: 'varchar', nullable: true })
  followingEventId: string | null;

  /** Confidence score for the attribution despite the gap (0-1) */
  @Column({ name: 'confidence_score', type: 'decimal', precision: 5, scale: 4 })
  confidenceScore: number;

  /** Human-readable reason for the gap */
  @Column({ name: 'gap_reason', type: 'text', nullable: true })
  gapReason: string | null;

  @CreateDateColumn({ name: 'detected_at' })
  detectedAt: Date;
}
