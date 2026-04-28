import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { DonationAttributionEntity } from './entities/donation-attribution.entity';
import { LineageGapEntity } from './entities/lineage-gap.entity';

export interface AttributionNode {
  eventType: 'pledge' | 'donation' | 'allocation' | 'delivery' | 'beneficiary';
  eventId: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export interface AttributionGraphInput {
  donorId?: string;
  pledgeId?: string;
  donationId?: string;
  bloodUnitId?: string;
  orderId?: string;
  beneficiaryId?: string;
  outcomeEventId?: string;
  outcomeType?: string;
  isPooled?: boolean;
  poolContributionPct?: number;
  lineagePath: AttributionNode[];
  metadata?: Record<string, any>;
}

export interface AttributionResult {
  correlationId: string;
  attributionScore: number;
  confidenceScore: number;
  gaps: LineageGapEntity[];
  attribution: DonationAttributionEntity;
}

/** Minimum confidence penalty per missing lineage segment */
const GAP_CONFIDENCE_PENALTY = 0.15;

@Injectable()
export class AttributionService {
  private readonly logger = new Logger(AttributionService.name);

  /** Expected event sequence for a complete lineage */
  private readonly EXPECTED_SEQUENCE: AttributionNode['eventType'][] = [
    'pledge',
    'donation',
    'allocation',
    'delivery',
    'beneficiary',
  ];

  constructor(
    @InjectRepository(DonationAttributionEntity)
    private readonly attributionRepo: Repository<DonationAttributionEntity>,
    @InjectRepository(LineageGapEntity)
    private readonly gapRepo: Repository<LineageGapEntity>,
  ) {}

  /**
   * Record an attribution graph for a donation-to-outcome chain.
   * Computes attribution score and confidence, detects lineage gaps.
   */
  async recordAttribution(input: AttributionGraphInput): Promise<AttributionResult> {
    const correlationId = this.buildCorrelationId(input);
    const { attributionScore, confidenceScore, gaps } = this.computeScores(input);

    const attribution = this.attributionRepo.create({
      correlationId,
      donorId: input.donorId ?? null,
      pledgeId: input.pledgeId ?? null,
      donationId: input.donationId ?? null,
      bloodUnitId: input.bloodUnitId ?? null,
      orderId: input.orderId ?? null,
      beneficiaryId: input.beneficiaryId ?? null,
      outcomeEventId: input.outcomeEventId ?? null,
      outcomeType: input.outcomeType ?? null,
      attributionScore,
      confidenceScore,
      lineagePath: input.lineagePath,
      isPooled: input.isPooled ?? false,
      poolContributionPct: input.poolContributionPct ?? null,
      metadata: input.metadata ?? null,
    });

    const saved = await this.attributionRepo.save(attribution);

    // Persist detected gaps
    const savedGaps: LineageGapEntity[] = [];
    for (const gap of gaps) {
      gap.correlationId = correlationId;
      const savedGap = await this.gapRepo.save(gap);
      savedGaps.push(savedGap);
    }

    this.logger.log(
      `Attribution recorded: correlationId=${correlationId} score=${attributionScore} confidence=${confidenceScore} gaps=${gaps.length}`,
    );

    return { correlationId, attributionScore, confidenceScore, gaps: savedGaps, attribution: saved };
  }

  /**
   * Retrieve the full attribution chain for a donor.
   */
  async getAttributionsByDonor(donorId: string): Promise<DonationAttributionEntity[]> {
    return this.attributionRepo.find({
      where: { donorId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Retrieve attribution by correlation ID (stable across replay).
   */
  async getByCorrelationId(correlationId: string): Promise<DonationAttributionEntity | null> {
    return this.attributionRepo.findOne({ where: { correlationId } });
  }

  /**
   * Retrieve lineage gaps for a correlation ID.
   */
  async getGapsByCorrelationId(correlationId: string): Promise<LineageGapEntity[]> {
    return this.gapRepo.find({ where: { correlationId } });
  }

  /**
   * Upsert attribution — idempotent on correlationId for replay stability.
   */
  async upsertAttribution(input: AttributionGraphInput): Promise<AttributionResult> {
    const correlationId = this.buildCorrelationId(input);
    const existing = await this.getByCorrelationId(correlationId);
    if (existing) {
      const gaps = await this.getGapsByCorrelationId(correlationId);
      return {
        correlationId,
        attributionScore: Number(existing.attributionScore),
        confidenceScore: Number(existing.confidenceScore),
        gaps,
        attribution: existing,
      };
    }
    return this.recordAttribution(input);
  }

  /**
   * Compute attribution and confidence scores from the lineage path.
   * Detects gaps and applies penalties.
   */
  computeScores(input: AttributionGraphInput): {
    attributionScore: number;
    confidenceScore: number;
    gaps: Omit<LineageGapEntity, 'id' | 'detectedAt'>[];
  } {
    const presentTypes = new Set(input.lineagePath.map((n) => n.eventType));
    const gaps: Omit<LineageGapEntity, 'id' | 'detectedAt'>[] = [];

    // For a one-time donation (no pledge), skip 'pledge' in expected sequence
    const expectedSequence = input.pledgeId
      ? this.EXPECTED_SEQUENCE
      : this.EXPECTED_SEQUENCE.filter((t) => t !== 'pledge');

    let missingCount = 0;
    for (let i = 0; i < expectedSequence.length; i++) {
      const eventType = expectedSequence[i];
      if (!presentTypes.has(eventType)) {
        missingCount++;
        const preceding = i > 0 ? input.lineagePath.find((n) => n.eventType === expectedSequence[i - 1]) : null;
        const following = i < expectedSequence.length - 1
          ? input.lineagePath.find((n) => n.eventType === expectedSequence[i + 1])
          : null;

        gaps.push({
          correlationId: '',
          missingEventType: eventType,
          precedingEventId: preceding?.eventId ?? null,
          followingEventId: following?.eventId ?? null,
          confidenceScore: Math.max(0, 1 - (missingCount * GAP_CONFIDENCE_PENALTY)),
          gapReason: `No ${eventType} event found in lineage path`,
        });
      }
    }

    const confidenceScore = Math.max(0, 1 - missingCount * GAP_CONFIDENCE_PENALTY);

    // Attribution score: for pooled donations, use contribution percentage
    let attributionScore = 1.0;
    if (input.isPooled && input.poolContributionPct != null) {
      attributionScore = Math.min(1, input.poolContributionPct / 100);
    }

    return { attributionScore, confidenceScore, gaps };
  }

  /**
   * Build a deterministic correlation ID from the available identifiers.
   * Stable across replay for the same logical chain.
   */
  private buildCorrelationId(input: AttributionGraphInput): string {
    const parts = [
      input.donorId ?? '',
      input.pledgeId ?? '',
      input.donationId ?? '',
      input.bloodUnitId ?? '',
      input.orderId ?? '',
    ].filter(Boolean);

    if (parts.length === 0) return uuidv4();

    // Deterministic: sort and hash the parts
    const key = parts.sort().join(':');
    // Simple deterministic ID using base64-like encoding of the key
    const hash = Buffer.from(key).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    return `ATTR-${hash}`;
  }
}
