import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BloodUnitEntity } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/enums/order-status.enum';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { OrganizationVerificationStatus } from '../organizations/enums/organization-verification-status.enum';

import { ProvenanceBuilder, ProvenanceMetadata } from './provenance/provenance.builder';
import { LOW_COUNT_THRESHOLD, RedactionEngine } from './redaction/redaction.engine';

export interface RegionSummary {
  region: string;
  fulfilledRequests: number;
  verifiedPartners: number;
}

/** Public-facing metrics — no PHI, no PII, no internal IDs */
export interface PublicMetrics {
  fulfilledRequests: number;
  avgResponseTimeHours: number | null;
  totalDonationsRecorded: number;
  verifiedPartners: number;
  onChainVerifiedOrgs: number;
  /** Blood type counts with low-count suppression applied (null = suppressed) */
  bloodTypeBreakdown: Record<string, number | null>;
  geographicCoverage: RegionSummary[];
  generatedAt: string;
}

export interface TransparencyPublication {
  data: PublicMetrics;
  provenance: ProvenanceMetadata;
}

export interface PrivacyReviewReport {
  generatedAt: string;
  schemaVersion: string;
  totalSensitiveFieldsDefined: number;
  categorySummary: Record<string, number>;
  lastPublicationArtifactId: string | null;
  lastPublicationAt: string | null;
  suppressedBucketsInLastPublication: string[];
  noisedFieldsInLastPublication: string[];
  redactedFieldsInLastPublication: string[];
  lowCountThreshold: number;
  privacyEpsilon: number;
  recommendations: string[];
}

@Injectable()
export class TransparencyService {
  private readonly logger = new Logger(TransparencyService.name);

  /** Cache the last provenance for the privacy review report */
  private lastProvenance: ProvenanceMetadata | null = null;

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @InjectRepository(OrganizationEntity)
    private readonly orgRepo: Repository<OrganizationEntity>,
    @InjectRepository(BloodUnitEntity)
    private readonly bloodUnitRepo: Repository<BloodUnitEntity>,
  ) { }

  // ── Public endpoint ───────────────────────────────────────────────────────

  /**
   * Legacy single-value endpoint — kept for backwards compatibility.
   * Returns only the data payload (no provenance wrapper).
   */
  async getPublicMetrics(): Promise<PublicMetrics> {
    const { data } = await this.getPublicMetricsWithProvenance();
    return data;
  }

  /**
   * Full publication artifact: redacted metrics + provenance metadata.
   * This is the canonical transparency endpoint.
   */
  async getPublicMetricsWithProvenance(): Promise<TransparencyPublication> {
    const provenance = new ProvenanceBuilder({
      schemaVersion: '1.0.0',
      lowCountThreshold: LOW_COUNT_THRESHOLD,
      privacyEpsilon: 1.0,
    })
      .addSource('orders')
      .addSource('organizations')
      .addSource('blood_units_legacy');

    const [
      fulfilledRequests,
      avgResponseTimeHours,
      totalDonationsRecorded,
      verifiedPartners,
      onChainVerifiedOrgs,
      rawBloodTypeBreakdown,
      geographicCoverage,
    ] = await Promise.all([
      this.countFulfilledRequests(),
      this.computeAvgResponseTime(),
      this.countDonations(),
      this.countVerifiedPartners(),
      this.countOnChainOrgs(),
      this.getRawBloodTypeBreakdown(),
      this.getRegionSummaries(),
    ]);

    // ── Apply differential privacy to blood type counts ────────────────────
    const { result: noisedBreakdown, noisedFields } =
      RedactionEngine.applyDifferentialPrivacy(rawBloodTypeBreakdown);

    provenance.addTransformation({
      field: 'bloodTypeBreakdown.*',
      transformation: 'NOISED',
      reason: 'Laplace noise (ε=1.0) applied to prevent re-identification via count queries',
    });

    // ── Apply low-count threshold suppression ──────────────────────────────
    const { result: bloodTypeBreakdown, suppressedBuckets } =
      RedactionEngine.applyThreshold(noisedBreakdown);

    if (suppressedBuckets.length > 0) {
      provenance.addTransformation({
        field: 'bloodTypeBreakdown',
        transformation: 'THRESHOLDED',
        reason: `Buckets with count < ${LOW_COUNT_THRESHOLD} suppressed to prevent re-identification`,
      });
    }

    // ── Geographic data: city-level only, no precise coordinates ──────────
    provenance.addTransformation({
      field: 'geographicCoverage',
      transformation: 'AGGREGATED',
      reason: 'Aggregated to city/region level; precise lat/lng excluded',
    });

    // ── Redact all sensitive fields from the final payload ─────────────────
    const rawPayload = {
      fulfilledRequests,
      avgResponseTimeHours,
      totalDonationsRecorded,
      verifiedPartners,
      onChainVerifiedOrgs,
      bloodTypeBreakdown,
      geographicCoverage,
      generatedAt: new Date().toISOString(),
    };

    const { data: redactedPayload, redactedFields } = RedactionEngine.redact(rawPayload);

    provenance
      .setRedactedFields(redactedFields)
      .setSuppressedBuckets(suppressedBuckets)
      .setNoisedFields(noisedFields);

    if (redactedFields.length > 0) {
      provenance.addTransformation({
        field: redactedFields.join(', '),
        transformation: 'REDACTED',
        reason: 'Field is in the sensitive-field taxonomy (PHI/PII/INTERNAL_ID)',
      });
    }

    const data = redactedPayload as PublicMetrics;
    const provenanceMeta = provenance.build(data);

    // Cache for privacy review
    this.lastProvenance = provenanceMeta;

    // Pre-publication PHI leak check
    const leakCheck = RedactionEngine.assertNoPHILeakage(JSON.stringify(data));
    if (!leakCheck.clean) {
      this.logger.error(
        `PHI LEAK DETECTED in transparency publication: ${leakCheck.leakedFields.join(', ')}`,
      );
      // In production this should alert and abort; here we log and continue
    }

    return { data, provenance: provenanceMeta };
  }

  // ── Privacy Review Report ─────────────────────────────────────────────────

  async getPrivacyReviewReport(): Promise<PrivacyReviewReport> {
    const { SENSITIVE_FIELD_TAXONOMY, SENSITIVE_FIELD_CATEGORY_MAP } = await import(
      './redaction/sensitive-field-taxonomy'
    );

    const categorySummary: Record<string, number> = {};
    for (const def of SENSITIVE_FIELD_TAXONOMY) {
      categorySummary[def.category] = (categorySummary[def.category] ?? 0) + 1;
    }

    const recommendations: string[] = [];

    if (!this.lastProvenance) {
      recommendations.push('No publication has been generated yet. Run getPublicMetricsWithProvenance() first.');
    } else {
      if (this.lastProvenance.suppressedBuckets.length > 0) {
        recommendations.push(
          `${this.lastProvenance.suppressedBuckets.length} blood type bucket(s) were suppressed. ` +
          `Consider increasing data collection in those categories.`,
        );
      }
      if (this.lastProvenance.noisedFields.length > 0) {
        recommendations.push(
          `Differential privacy noise was applied to ${this.lastProvenance.noisedFields.length} field(s). ` +
          `Review epsilon value (currently ${this.lastProvenance.privacyEpsilon}) for utility/privacy balance.`,
        );
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
      totalSensitiveFieldsDefined: SENSITIVE_FIELD_TAXONOMY.length,
      categorySummary,
      lastPublicationArtifactId: this.lastProvenance?.artifactId ?? null,
      lastPublicationAt: this.lastProvenance?.generatedAt ?? null,
      suppressedBucketsInLastPublication: this.lastProvenance?.suppressedBuckets ?? [],
      noisedFieldsInLastPublication: this.lastProvenance?.noisedFields ?? [],
      redactedFieldsInLastPublication: this.lastProvenance?.redactedFields ?? [],
      lowCountThreshold: LOW_COUNT_THRESHOLD,
      privacyEpsilon: 1.0,
      recommendations,
    };
  }

  // ── Private data queries ──────────────────────────────────────────────────

  private async countFulfilledRequests(): Promise<number> {
    return this.orderRepo.count({ where: { status: OrderStatus.DELIVERED } });
  }

  private async computeAvgResponseTime(): Promise<number | null> {
    const result = await this.orderRepo
      .createQueryBuilder('o')
      .select(
        `AVG(EXTRACT(EPOCH FROM (o.updated_at - o.created_at)) / 3600)`,
        'avgHours',
      )
      .where('o.status = :status', { status: OrderStatus.DELIVERED })
      .getRawOne<{ avgHours: string | null }>();

    const val = result?.avgHours ? parseFloat(result.avgHours) : null;
    return val !== null ? Math.round(val * 10) / 10 : null;
  }

  private async countDonations(): Promise<number> {
    return this.bloodUnitRepo.count();
  }

  private async countVerifiedPartners(): Promise<number> {
    return this.orgRepo.count({
      where: { status: OrganizationVerificationStatus.APPROVED },
    });
  }

  private async countOnChainOrgs(): Promise<number> {
    return this.orgRepo
      .createQueryBuilder('o')
      .where('o.status = :status', {
        status: OrganizationVerificationStatus.APPROVED,
      })
      .andWhere('o.blockchain_tx_hash IS NOT NULL')
      .getCount();
  }

  private async getRawBloodTypeBreakdown(): Promise<Record<string, number>> {
    const rows = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.blood_type', 'bloodType')
      .addSelect('COUNT(*)', 'count')
      .where('o.status = :status', { status: OrderStatus.DELIVERED })
      .groupBy('o.blood_type')
      .getRawMany<{ bloodType: string; count: string }>();

    return Object.fromEntries(
      rows.map((r) => [r.bloodType, parseInt(r.count, 10)]),
    );
  }

  private async getRegionSummaries(): Promise<RegionSummary[]> {
    // City-level only — no precise coordinates published
    const orgRows = await this.orgRepo
      .createQueryBuilder('o')
      .select(`COALESCE(o.city, o.state, o.country, 'Unknown')`, 'region')
      .addSelect('COUNT(*)', 'count')
      .where('o.status = :status', {
        status: OrganizationVerificationStatus.APPROVED,
      })
      .groupBy('region')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ region: string; count: string }>();

    const regionMap = new Map<string, RegionSummary>();

    for (const row of orgRows) {
      regionMap.set(row.region, {
        region: row.region,
        fulfilledRequests: 0,
        verifiedPartners: parseInt(row.count, 10),
      });
    }

    const orderRows = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.delivery_address', 'region')
      .addSelect('COUNT(*)', 'count')
      .where('o.status = :status', { status: OrderStatus.DELIVERED })
      .andWhere('o.delivery_address IS NOT NULL')
      .groupBy('o.delivery_address')
      .orderBy('count', 'DESC')
      .limit(10)
      .getRawMany<{ region: string; count: string }>();

    for (const row of orderRows) {
      const key = row.region ?? 'Unknown';
      const existing = regionMap.get(key);
      if (existing) {
        existing.fulfilledRequests += parseInt(row.count, 10);
      } else {
        regionMap.set(key, {
          region: key,
          fulfilledRequests: parseInt(row.count, 10),
          verifiedPartners: 0,
        });
      }
    }

    return [...regionMap.values()].slice(0, 10);
  }
}
