import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ConsentRecordEntity } from './entities/consent-record.entity';
import { ConsentTermEntity } from './entities/consent-term.entity';

@Injectable()
export class ConsentService {
  private readonly logger = new Logger(ConsentService.name);

  constructor(
    @InjectRepository(ConsentTermEntity)
    private readonly termRepo: Repository<ConsentTermEntity>,
    @InjectRepository(ConsentRecordEntity)
    private readonly recordRepo: Repository<ConsentRecordEntity>,
  ) {}

  // ── Term management ───────────────────────────────────────────────────────

  /** Publish a new consent term version and mark it as the active one. */
  async publishTerm(params: {
    versionLabel: string;
    versionHash: string;
    changeSummary?: string;
  }): Promise<ConsentTermEntity> {
    const existing = await this.termRepo.findOne({
      where: { versionHash: params.versionHash },
    });
    if (existing) {
      throw new ConflictException(
        `Consent term with hash '${params.versionHash}' already exists (version ${existing.versionLabel}).`,
      );
    }

    // Deactivate all previous terms
    await this.termRepo.update({ isActive: true }, { isActive: false });

    const term = this.termRepo.create({
      versionLabel: params.versionLabel,
      versionHash: params.versionHash,
      changeSummary: params.changeSummary ?? null,
      isActive: true,
    });

    const saved = await this.termRepo.save(term);
    this.logger.log(
      `New consent term published: ${saved.versionLabel} (${saved.versionHash})`,
    );
    return saved;
  }

  /** Returns the currently active consent term, or null if none published. */
  async getActiveTerm(): Promise<ConsentTermEntity | null> {
    return this.termRepo.findOne({ where: { isActive: true } });
  }

  // ── Participant consent ───────────────────────────────────────────────────

  /**
   * Record that a participant has accepted the currently active consent terms.
   * Revokes any previous active record for the same participant first.
   */
  async recordConsent(params: {
    participantId: string;
    consentSource?: string;
  }): Promise<ConsentRecordEntity> {
    const activeTerm = await this.getActiveTerm();
    if (!activeTerm) {
      throw new NotFoundException(
        'No active consent terms found. An administrator must publish consent terms before participants can enroll.',
      );
    }

    // Revoke previous active consent records for this participant
    await this.recordRepo.update(
      { participantId: params.participantId, isActive: true },
      { isActive: false, revokedAt: new Date() },
    );

    const record = this.recordRepo.create({
      participantId: params.participantId,
      consentTermId: activeTerm.id,
      versionHashAtConsent: activeTerm.versionHash,
      isActive: true,
      consentSource: params.consentSource ?? null,
    });

    const saved = await this.recordRepo.save(record);
    this.logger.log(
      `Consent recorded for participant ${params.participantId} under term ${activeTerm.versionLabel}`,
    );
    return saved;
  }

  /**
   * Returns the active consent record for a participant, or null if none.
   */
  async getActiveConsent(participantId: string): Promise<ConsentRecordEntity | null> {
    return this.recordRepo.findOne({
      where: { participantId, isActive: true },
    });
  }

  /**
   * Checks whether the participant's active consent is current (matches the
   * active term's hash). Returns a structured result so callers can decide
   * how to respond (throw, redirect to re-consent flow, etc.).
   */
  async checkConsentCurrency(participantId: string): Promise<{
    isCurrent: boolean;
    requiresReconsent: boolean;
    activeTermHash: string | null;
    participantHash: string | null;
  }> {
    const [activeTerm, record] = await Promise.all([
      this.getActiveTerm(),
      this.getActiveConsent(participantId),
    ]);

    const activeTermHash = activeTerm?.versionHash ?? null;
    const participantHash = record?.versionHashAtConsent ?? null;

    const isCurrent =
      !!activeTerm && !!record && record.versionHashAtConsent === activeTerm.versionHash;

    return {
      isCurrent,
      requiresReconsent: !!activeTerm && !isCurrent,
      activeTermHash,
      participantHash,
    };
  }

  /**
   * Asserts that the participant has current consent.
   * Throws ConflictException with a re-consent prompt if they are under
   * superseded terms or have never consented.
   */
  async assertCurrentConsent(participantId: string): Promise<void> {
    const status = await this.checkConsentCurrency(participantId);

    if (!status.isCurrent) {
      const reason = !status.participantHash
        ? 'No consent record found'
        : `Consent version drift detected (participant: ${status.participantHash}, current: ${status.activeTermHash})`;

      throw new ConflictException(
        `Participant '${participantId}' must re-consent to the current terms before proceeding. ${reason}.`,
      );
    }
  }

  /**
   * Returns all participants whose active consent hash no longer matches
   * the current active term. Used for batch re-consent enforcement jobs.
   */
  async findParticipantsWithDriftedConsent(): Promise<string[]> {
    const activeTerm = await this.getActiveTerm();
    if (!activeTerm) return [];

    const drifted = await this.recordRepo
      .createQueryBuilder('r')
      .select('r.participantId', 'participantId')
      .where('r.isActive = true')
      .andWhere('r.versionHashAtConsent != :hash', { hash: activeTerm.versionHash })
      .getRawMany<{ participantId: string }>();

    return drifted.map((r) => r.participantId);
  }
}
