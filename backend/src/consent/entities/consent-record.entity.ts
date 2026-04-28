import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ConsentTermEntity } from './consent-term.entity';

/**
 * Records that a specific participant (donor, patient, etc.) has accepted
 * a specific version of the consent terms.
 *
 * When the active ConsentTermEntity changes, any participant whose
 * `consentTermId` no longer matches the active term is considered to be
 * operating under superseded consent and must re-consent before mutations.
 */
@Entity('consent_records')
@Index('IDX_CONSENT_RECORDS_PARTICIPANT', ['participantId'])
@Index('IDX_CONSENT_RECORDS_TERM', ['consentTermId'])
@Index('IDX_CONSENT_RECORDS_ACTIVE', ['participantId', 'isActive'])
export class ConsentRecordEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The user/donor/patient who gave consent */
  @Column({ name: 'participant_id', type: 'uuid' })
  participantId: string;

  /** The consent term version they agreed to */
  @Column({ name: 'consent_term_id', type: 'uuid' })
  consentTermId: string;

  @ManyToOne(() => ConsentTermEntity, { eager: true })
  @JoinColumn({ name: 'consent_term_id' })
  consentTerm: ConsentTermEntity;

  /**
   * Snapshot of the version hash at the time of consent.
   * Stored redundantly so drift is detectable even if the term row is updated.
   */
  @Column({ name: 'version_hash_at_consent', type: 'varchar', length: 64 })
  versionHashAtConsent: string;

  /** Only the most recent record per participant should be active */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** IP or device fingerprint for audit purposes */
  @Column({ name: 'consent_source', type: 'varchar', length: 255, nullable: true })
  consentSource: string | null;

  @CreateDateColumn({ name: 'consented_at' })
  consentedAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamp', nullable: true })
  revokedAt: Date | null;
}
