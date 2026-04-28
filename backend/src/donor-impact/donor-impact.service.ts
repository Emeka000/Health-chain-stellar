import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BloodUnitEntity } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/enums/order-status.enum';
import { DonationEntity } from '../donations/entities/donation.entity';
import { PledgeEntity } from '../donations/entities/pledge.entity';

import { AttributionService } from './attribution.service';
import { DonationAttributionEntity } from './entities/donation-attribution.entity';
import { LineageGapEntity } from './entities/lineage-gap.entity';

export interface DonorImpactSummary {
  donorRef: string;
  totalDonations: number;
  totalMlDonated: number;
  requestsFulfilled: number;
  estimatedPatientsSupported: number;
  timeline: DonorImpactEvent[];
}

export interface DonorImpactEvent {
  date: Date;
  type: 'donation' | 'fulfillment';
  description: string;
  bloodType: string;
  quantityMl?: number;
  onChainRef?: string;
}

export interface PublicImpactSummary {
  organizationId: string;
  totalRequestsFulfilled: number;
  totalUnitsByBloodType: Record<string, number>;
  periodStart: Date;
  periodEnd: Date;
}

export interface AttributedImpactReport {
  donorRef: string;
  totalAttributedOutcomes: number;
  attributions: AttributionSummary[];
  lineageGaps: LineageGapSummary[];
  overallConfidence: number;
}

export interface AttributionSummary {
  correlationId: string;
  attributionScore: number;
  confidenceScore: number;
  outcomeType: string | null;
  outcomeEventId: string | null;
  isPooled: boolean;
  poolContributionPct: number | null;
  lineagePath: DonationAttributionEntity['lineagePath'];
  createdAt: Date;
}

export interface LineageGapSummary {
  correlationId: string;
  missingEventType: string;
  confidenceScore: number;
  gapReason: string | null;
}

export interface DrillDownEvidence {
  correlationId: string;
  attribution: DonationAttributionEntity;
  gaps: LineageGapEntity[];
  evidenceRefs: {
    pledgeId?: string;
    donationId?: string;
    bloodUnitId?: string;
    orderId?: string;
    beneficiaryId?: string;
    outcomeEventId?: string;
  };
}

@Injectable()
export class DonorImpactService {
  constructor(
    @InjectRepository(BloodUnitEntity)
    private readonly bloodUnitRepo: Repository<BloodUnitEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @InjectRepository(DonationEntity)
    private readonly donationRepo: Repository<DonationEntity>,
    @InjectRepository(PledgeEntity)
    private readonly pledgeRepo: Repository<PledgeEntity>,
    private readonly attributionService: AttributionService,
  ) {}

  async getDonorImpact(donorId: string): Promise<DonorImpactSummary> {
    const donorRef = this.anonymizeRef(donorId);

    const units = await this.bloodUnitRepo.find({
      where: { donorId },
      order: { createdAt: 'DESC' },
    });

    const fulfilledOrders = await this.orderRepo
      .createQueryBuilder('o')
      .where('o.status = :status', { status: OrderStatus.DELIVERED })
      .andWhere(
        `o.blood_type IN (:...types)`,
        { types: units.length ? [...new Set(units.map((u) => u.bloodType))] : ['NONE'] },
      )
      .getMany();

    const timeline: DonorImpactEvent[] = units.map((u) => ({
      date: u.createdAt,
      type: 'donation',
      description: `Donated ${u.volumeMl}ml of ${u.bloodType}`,
      bloodType: u.bloodType,
      quantityMl: u.volumeMl,
      onChainRef: u.blockchainTxHash ?? undefined,
    }));

    return {
      donorRef,
      totalDonations: units.length,
      totalMlDonated: units.reduce((sum, u) => sum + u.volumeMl, 0),
      requestsFulfilled: fulfilledOrders.length,
      estimatedPatientsSupported: units.length * 3,
      timeline: timeline.slice(0, 20),
    };
  }

  /**
   * Returns a full attributed impact report with causal linkage to outcomes.
   * Includes confidence indicators for incomplete lineage segments.
   */
  async getAttributedImpactReport(donorId: string): Promise<AttributedImpactReport> {
    const donorRef = this.anonymizeRef(donorId);
    const attributions = await this.attributionService.getAttributionsByDonor(donorId);

    const attributionSummaries: AttributionSummary[] = attributions.map((a) => ({
      correlationId: a.correlationId,
      attributionScore: Number(a.attributionScore),
      confidenceScore: Number(a.confidenceScore),
      outcomeType: a.outcomeType,
      outcomeEventId: a.outcomeEventId,
      isPooled: a.isPooled,
      poolContributionPct: a.poolContributionPct != null ? Number(a.poolContributionPct) : null,
      lineagePath: a.lineagePath,
      createdAt: a.createdAt,
    }));

    // Collect all gaps across all attributions
    const allGaps: LineageGapSummary[] = [];
    for (const a of attributions) {
      const gaps = await this.attributionService.getGapsByCorrelationId(a.correlationId);
      for (const g of gaps) {
        allGaps.push({
          correlationId: g.correlationId,
          missingEventType: g.missingEventType,
          confidenceScore: Number(g.confidenceScore),
          gapReason: g.gapReason,
        });
      }
    }

    const overallConfidence = attributionSummaries.length > 0
      ? attributionSummaries.reduce((sum, a) => sum + a.confidenceScore, 0) / attributionSummaries.length
      : 0;

    return {
      donorRef,
      totalAttributedOutcomes: attributionSummaries.filter((a) => a.outcomeEventId != null).length,
      attributions: attributionSummaries,
      lineageGaps: allGaps,
      overallConfidence,
    };
  }

  /**
   * Drill-down evidence for a specific attribution correlation ID.
   */
  async getDrillDownEvidence(correlationId: string): Promise<DrillDownEvidence | null> {
    const attribution = await this.attributionService.getByCorrelationId(correlationId);
    if (!attribution) return null;

    const gaps = await this.attributionService.getGapsByCorrelationId(correlationId);

    return {
      correlationId,
      attribution,
      gaps,
      evidenceRefs: {
        pledgeId: attribution.pledgeId ?? undefined,
        donationId: attribution.donationId ?? undefined,
        bloodUnitId: attribution.bloodUnitId ?? undefined,
        orderId: attribution.orderId ?? undefined,
        beneficiaryId: attribution.beneficiaryId ?? undefined,
        outcomeEventId: attribution.outcomeEventId ?? undefined,
      },
    };
  }

  async getPublicImpactSummary(organizationId: string): Promise<PublicImpactSummary> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const orders = await this.orderRepo
      .createQueryBuilder('o')
      .where('o.blood_bank_id = :orgId', { orgId: organizationId })
      .andWhere('o.status = :status', { status: OrderStatus.DELIVERED })
      .andWhere('o.created_at >= :since', { since: thirtyDaysAgo })
      .getMany();

    const unitsByType: Record<string, number> = {};
    for (const order of orders) {
      unitsByType[order.bloodType] = (unitsByType[order.bloodType] ?? 0) + order.quantity;
    }

    return {
      organizationId,
      totalRequestsFulfilled: orders.length,
      totalUnitsByBloodType: unitsByType,
      periodStart: thirtyDaysAgo,
      periodEnd: new Date(),
    };
  }

  private anonymizeRef(donorId: string): string {
    return `DONOR-${donorId.slice(0, 4).toUpperCase()}****`;
  }
}
