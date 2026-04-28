import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Represents a published version of consent terms.
 * A new row must be inserted whenever protocol or consent language changes.
 * The `versionHash` is a SHA-256 of the canonical consent document content.
 */
@Entity('consent_terms')
@Index('IDX_CONSENT_TERMS_ACTIVE', ['isActive'])
export class ConsentTermEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Semantic version label, e.g. "2.1.0" */
  @Column({ name: 'version_label', type: 'varchar', length: 32 })
  versionLabel: string;

  /**
   * SHA-256 hex digest of the canonical consent document.
   * This is the authoritative identifier used for drift detection.
   */
  @Column({ name: 'version_hash', type: 'varchar', length: 64, unique: true })
  versionHash: string;

  /** Human-readable summary of what changed in this version */
  @Column({ name: 'change_summary', type: 'text', nullable: true })
  changeSummary: string | null;

  /** Only one term set is active at a time */
  @Column({ name: 'is_active', type: 'boolean', default: false })
  isActive: boolean;

  @CreateDateColumn({ name: 'published_at' })
  publishedAt: Date;
}
