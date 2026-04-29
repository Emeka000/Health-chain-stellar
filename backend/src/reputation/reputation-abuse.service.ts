import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';

import { ReputationHistoryEntity } from './entities/reputation-history.entity';
import {
  AbuseFlag,
  ModerationStatus,
  ReputationAbuseFlagEntity,
} from './entities/reputation-abuse-flag.entity';
import { ReputationEventType } from './enums/reputation-event-type.enum';

/** Maximum rating actions per rider per rolling window */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Point delta above which we require stronger trust signals */
const HIGH_IMPACT_THRESHOLD = 20;

/** Minimum distinct counterparties required to avoid collusion flag */
const COLLUSION_DIVERSITY_MIN = 3;

/** Delay (ms) before a flagged rating is finalised */
export const FINALIZATION_DELAY_MS = 24 * 60 * 60 * 1000; // 24 h

@Injectable()
export class ReputationAbuseService {
  private readonly logger = new Logger(ReputationAbuseService.name);

  constructor(
    @InjectRepository(ReputationAbuseFlagEntity)
    private readonly flagRepo: Repository<ReputationAbuseFlagEntity>,
    @InjectRepository(ReputationHistoryEntity)
    private readonly historyRepo: Repository<ReputationHistoryEntity>,
  ) {}

  // ── Rate-limit check ──────────────────────────────────────────────────────

  /**
   * Returns true if the rider has exceeded the rating action rate limit.
   * Raises a flag record when the limit is first breached.
   */
  async checkRateLimit(riderId: string, reputationId: string): Promise<boolean> {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const count = await this.historyRepo.count({
      where: { reputationId, createdAt: MoreThan(since) },
    });

    if (count >= RATE_LIMIT_MAX) {
      await this.raiseFlag(riderId, AbuseFlag.RATE_LIMIT_EXCEEDED, null, 0, {
        windowMs: RATE_LIMIT_WINDOW_MS,
        count,
        limit: RATE_LIMIT_MAX,
      });
      return true;
    }
    return false;
  }

  // ── High-impact change check ──────────────────────────────────────────────

  /**
   * High-impact positive changes (delta > threshold) require admin validation.
   * Returns true if the change should be withheld pending review.
   */
  async checkHighImpact(
    riderId: string,
    delta: number,
    historyId: string | null,
    validatedByAdmin: boolean,
  ): Promise<boolean> {
    if (delta <= HIGH_IMPACT_THRESHOLD || validatedByAdmin) return false;

    await this.raiseFlag(riderId, AbuseFlag.HIGH_IMPACT_UNVERIFIED, historyId, delta, {
      delta,
      threshold: HIGH_IMPACT_THRESHOLD,
    });
    return true;
  }

  // ── Collusion / diversity check ───────────────────────────────────────────

  /**
   * Detects dense reciprocal rating clusters by checking whether the rider's
   * recent positive history comes from fewer than COLLUSION_DIVERSITY_MIN
   * distinct reference IDs (counterparties).
   *
   * Returns a down-weight multiplier: 1.0 = no penalty, < 1.0 = penalised.
   */
  async collusionWeight(riderId: string, reputationId: string): Promise<number> {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS * 24); // 24 h window
    const recentPositive = await this.historyRepo.find({
      where: {
        reputationId,
        eventType: ReputationEventType.DELIVERY_COMPLETED,
        createdAt: MoreThan(since),
      },
      select: ['referenceId'],
    });

    const distinctCounterparties = new Set(
      recentPositive.map((h) => h.referenceId).filter(Boolean),
    ).size;

    if (recentPositive.length >= RATE_LIMIT_MAX && distinctCounterparties < COLLUSION_DIVERSITY_MIN) {
      await this.raiseFlag(riderId, AbuseFlag.COLLUSION_CLUSTER, null, 0, {
        recentCount: recentPositive.length,
        distinctCounterparties,
        diversityMin: COLLUSION_DIVERSITY_MIN,
      });
      // Down-weight: score the cluster at 50 % of face value
      return 0.5;
    }
    return 1.0;
  }

  // ── Sybil / account-age weighting ────────────────────────────────────────

  /**
   * Returns a trust multiplier based on account age and transaction depth.
   * New accounts with few transactions receive a reduced weight.
   *
   * @param accountCreatedAt  ISO timestamp of account creation
   * @param totalTransactions total completed transactions on record
   */
  sybilWeight(accountCreatedAt: Date, totalTransactions: number): number {
    const ageMs = Date.now() - accountCreatedAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays < 7 || totalTransactions < 3) return 0.25;
    if (ageDays < 30 || totalTransactions < 10) return 0.6;
    if (ageDays < 90 || totalTransactions < 25) return 0.85;
    return 1.0;
  }

  // ── Moderation workflow ───────────────────────────────────────────────────

  /** List all flags pending moderation review. */
  async listPendingFlags(): Promise<ReputationAbuseFlagEntity[]> {
    return this.flagRepo.find({
      where: { status: ModerationStatus.PENDING },
      order: { createdAt: 'ASC' },
    });
  }

  /** Mark a flag as under active review. */
  async startReview(flagId: string, reviewerId: string): Promise<ReputationAbuseFlagEntity> {
    const flag = await this.findFlagOrFail(flagId);
    flag.status = ModerationStatus.UNDER_REVIEW;
    flag.reviewedBy = reviewerId;
    return this.flagRepo.save(flag);
  }

  /** Clear a flag — the withheld delta is safe to apply. */
  async clearFlag(
    flagId: string,
    reviewerId: string,
    note: string,
  ): Promise<ReputationAbuseFlagEntity> {
    const flag = await this.findFlagOrFail(flagId);
    if (flag.status === ModerationStatus.REVERSED) {
      throw new ForbiddenException('Flag already reversed');
    }
    flag.status = ModerationStatus.CLEARED;
    flag.reviewedBy = reviewerId;
    flag.reviewedAt = new Date();
    flag.reviewNote = note;
    return this.flagRepo.save(flag);
  }

  /** Reverse a flag — the withheld delta should NOT be applied; undo if already applied. */
  async reverseFlag(
    flagId: string,
    reviewerId: string,
    note: string,
  ): Promise<ReputationAbuseFlagEntity> {
    const flag = await this.findFlagOrFail(flagId);
    if (flag.status === ModerationStatus.CLEARED) {
      throw new ForbiddenException('Flag already cleared');
    }
    flag.status = ModerationStatus.REVERSED;
    flag.reviewedBy = reviewerId;
    flag.reviewedAt = new Date();
    flag.reviewNote = note;
    return this.flagRepo.save(flag);
  }

  // ── Delayed finalization ──────────────────────────────────────────────────

  /**
   * Returns true if a flagged history entry has passed the finalization delay
   * and its flag has been cleared (or no flag exists).
   */
  async isFinalized(historyId: string): Promise<boolean> {
    const flag = await this.flagRepo.findOne({ where: { historyId } });
    if (!flag) return true; // no flag → immediately final
    if (flag.status === ModerationStatus.REVERSED) return false;
    if (flag.status !== ModerationStatus.CLEARED) return false;
    const elapsed = Date.now() - (flag.reviewedAt?.getTime() ?? 0);
    return elapsed >= FINALIZATION_DELAY_MS;
  }

  // ── Backtesting helper ────────────────────────────────────────────────────

  /**
   * Runs the anti-abuse filters over a batch of historical history entries
   * and returns a summary of how many would have been flagged.
   * Used for backtesting / calibration.
   */
  async backtestFilters(
    entries: Array<{ riderId: string; reputationId: string; delta: number; referenceId?: string }>,
  ): Promise<{ total: number; flagged: number; flagRate: number }> {
    let flagged = 0;
    for (const e of entries) {
      const highImpact = e.delta > HIGH_IMPACT_THRESHOLD;
      if (highImpact) flagged++;
    }
    return { total: entries.length, flagged, flagRate: entries.length ? flagged / entries.length : 0 };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private async raiseFlag(
    riderId: string,
    flag: AbuseFlag,
    historyId: string | null,
    withheldDelta: number,
    evidence: Record<string, unknown>,
  ): Promise<ReputationAbuseFlagEntity> {
    this.logger.warn(`Reputation abuse flag raised: ${flag} for rider ${riderId}`);
    const entity = this.flagRepo.create({
      riderId,
      historyId,
      flag,
      status: ModerationStatus.PENDING,
      evidence,
      withheldDelta,
    });
    return this.flagRepo.save(entity);
  }

  private async findFlagOrFail(flagId: string): Promise<ReputationAbuseFlagEntity> {
    const flag = await this.flagRepo.findOne({ where: { id: flagId } });
    if (!flag) throw new NotFoundException(`Abuse flag '${flagId}' not found`);
    return flag;
  }
}
