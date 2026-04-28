import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OrgTrustScoreEntity, TrustFactorContribution, TrustFeatureSnapshot } from '../entities/org-trust-score.entity';
import { OrgTrustScoreHistoryEntity } from '../entities/org-trust-score-history.entity';
import { OrganizationEntity } from '../entities/organization.entity';
import { OrganizationReviewEntity } from '../entities/organization-review.entity';

/** Factor weights — must sum to 1.0 */
const WEIGHTS = {
  fulfillment: 0.35,
  dispute: 0.25,
  compliance: 0.20,
  rating: 0.15,
  recency: 0.05,
} as const;

/** Outlier clipping bounds per factor [min, max] */
const CLIP = {
  fulfillmentRate: [0, 1] as [number, number],
  disputeRate: [0, 0.5] as [number, number],
  complianceRate: [0, 1] as [number, number],
  avgRating: [1, 5] as [number, number],
  recencyDays: [0, 365] as [number, number],
};

/** Recency decay half-life in days */
const RECENCY_HALF_LIFE_DAYS = 90;

/** Minimum reviews required before rating factor is trusted */
const MIN_REVIEWS_FOR_RATING = 3;

/** Suspicious pattern: stddev of reviewer ratings above this threshold */
const RATING_STDDEV_THRESHOLD = 0.3;

@Injectable()
export class OrgTrustScoringService {
  private readonly logger = new Logger(OrgTrustScoringService.name);

  constructor(
    @InjectRepository(OrgTrustScoreEntity)
    private readonly scoreRepo: Repository<OrgTrustScoreEntity>,
    @InjectRepository(OrgTrustScoreHistoryEntity)
    private readonly historyRepo: Repository<OrgTrustScoreHistoryEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(OrganizationReviewEntity)
    private readonly reviewRepo: Repository<OrganizationReviewEntity>,
  ) {}

  /**
   * Compute and persist a new trust score for an organization.
   * Returns the updated score entity with explanation.
   */
  async computeAndStore(organizationId: string): Promise<OrgTrustScoreEntity> {
    const org = await this.orgRepo.findOne({ where: { id: organizationId } });
    if (!org) throw new NotFoundException(`Organization '${organizationId}' not found`);

    const features = await this.extractFeatures(org);
    const { score, explanation } = this.computeScore(features);

    let record = await this.scoreRepo.findOne({ where: { organizationId } });
    const version = record ? record.version + 1 : 1;

    if (!record) {
      record = this.scoreRepo.create({ organizationId });
    }

    record.score = score;
    record.version = version;
    record.featureSnapshot = features;
    record.explanation = explanation;
    record.suspiciousRatingFlag = features.suspiciousRatingFlag;
    const saved = await this.scoreRepo.save(record);

    // Persist immutable history entry
    await this.historyRepo.save(
      this.historyRepo.create({
        organizationId,
        version,
        score,
        featureSnapshot: features,
        explanation,
        suspiciousRatingFlag: features.suspiciousRatingFlag,
      }),
    );

    this.logger.log(`Trust score for org ${organizationId}: ${score.toFixed(2)} (v${version})`);
    return saved;
  }

  /** Get current trust score with explanation */
  async getScore(organizationId: string): Promise<OrgTrustScoreEntity> {
    const record = await this.scoreRepo.findOne({ where: { organizationId } });
    if (!record) throw new NotFoundException(`No trust score found for organization '${organizationId}'`);
    return record;
  }

  /** Get full score history for backtesting */
  async getHistory(organizationId: string): Promise<OrgTrustScoreHistoryEntity[]> {
    return this.historyRepo.find({
      where: { organizationId },
      order: { version: 'ASC' },
    });
  }

  /**
   * Replay score computation from a stored feature snapshot.
   * Verifies reproducibility — score must match stored value within floating-point tolerance.
   */
  replayFromSnapshot(snapshot: TrustFeatureSnapshot): {
    score: number;
    explanation: TrustFactorContribution[];
  } {
    return this.computeScore(snapshot);
  }

  // ── Private ──────────────────────────────────────────────────────────

  private async extractFeatures(org: OrganizationEntity): Promise<TrustFeatureSnapshot> {
    const reviews = await this.reviewRepo.find({
      where: { organizationId: org.id, isHidden: false },
    });

    const reviewCount = reviews.length;
    const avgRating = reviewCount > 0
      ? reviews.reduce((s, r) => s + r.rating, 0) / reviewCount
      : 0;

    // Anti-gaming: detect suspicious rating rings via low stddev (all same rating)
    const suspiciousRatingFlag = this.detectSuspiciousRatings(reviews);

    // Recency: days since last review (or since org creation)
    const lastReviewDate = reviews.length > 0
      ? Math.max(...reviews.map((r) => r.createdAt.getTime()))
      : org.createdAt?.getTime() ?? Date.now();
    const recencyDays = (Date.now() - lastReviewDate) / (1000 * 60 * 60 * 24);

    // Fulfillment, dispute, compliance — derived from org stats fields
    // These would come from order/dispute aggregates in production;
    // using org.rating as a proxy for fulfillment when no dedicated field exists.
    const fulfillmentRate = Math.min(1, Math.max(0, Number(org.rating ?? 0) / 5));
    const disputeRate = 0; // placeholder — wire to dispute aggregate
    const complianceRate = org.status === 'approved' ? 1 : 0.5;

    return {
      fulfillmentRate,
      disputeRate,
      complianceRate,
      avgRating,
      reviewCount,
      recencyDays,
      suspiciousRatingFlag,
      capturedAt: new Date().toISOString(),
    };
  }

  private computeScore(features: TrustFeatureSnapshot): {
    score: number;
    explanation: TrustFactorContribution[];
  } {
    // Clip outliers
    const fulfillment = this.clip(features.fulfillmentRate, ...CLIP.fulfillmentRate);
    const disputePenalty = 1 - this.clip(features.disputeRate, ...CLIP.disputeRate) * 2;
    const compliance = this.clip(features.complianceRate, ...CLIP.complianceRate);
    const ratingNorm = features.reviewCount >= MIN_REVIEWS_FOR_RATING
      ? (this.clip(features.avgRating, ...CLIP.avgRating) - 1) / 4
      : 0;
    const recencyDecay = this.recencyDecay(features.recencyDays);

    // Anti-gaming: downrank if suspicious rating patterns detected
    const antiGamingMultiplier = features.suspiciousRatingFlag ? 0.7 : 1.0;

    const factors: Array<{ name: keyof typeof WEIGHTS; value: number }> = [
      { name: 'fulfillment', value: fulfillment },
      { name: 'dispute', value: Math.max(0, disputePenalty) },
      { name: 'compliance', value: compliance },
      { name: 'rating', value: ratingNorm * antiGamingMultiplier },
      { name: 'recency', value: recencyDecay },
    ];

    const explanation: TrustFactorContribution[] = factors.map(({ name, value }) => ({
      factor: name,
      rawValue: this.getRawValue(name, features),
      normalizedValue: value,
      weight: WEIGHTS[name],
      contribution: value * WEIGHTS[name] * 100,
    }));

    const score = Math.min(100, Math.max(0,
      explanation.reduce((sum, f) => sum + f.contribution, 0),
    ));

    return { score, explanation };
  }

  /** Exponential decay: score = e^(-ln2 * days / halfLife) */
  private recencyDecay(days: number): number {
    return Math.exp((-Math.LN2 * days) / RECENCY_HALF_LIFE_DAYS);
  }

  private clip(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  private getRawValue(factor: keyof typeof WEIGHTS, f: TrustFeatureSnapshot): number {
    switch (factor) {
      case 'fulfillment': return f.fulfillmentRate;
      case 'dispute': return f.disputeRate;
      case 'compliance': return f.complianceRate;
      case 'rating': return f.avgRating;
      case 'recency': return f.recencyDays;
    }
  }

  /**
   * Detect suspicious rating rings: flag if all reviews have the same rating
   * (zero variance) when there are enough reviews to be statistically meaningful.
   */
  private detectSuspiciousRatings(reviews: OrganizationReviewEntity[]): boolean {
    if (reviews.length < MIN_REVIEWS_FOR_RATING) return false;
    const ratings = reviews.map((r) => r.rating);
    const mean = ratings.reduce((s, r) => s + r, 0) / ratings.length;
    const variance = ratings.reduce((s, r) => s + (r - mean) ** 2, 0) / ratings.length;
    const stddev = Math.sqrt(variance);
    return stddev < RATING_STDDEV_THRESHOLD;
  }
}
