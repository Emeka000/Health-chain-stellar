/**
 * Donation Attribution Contract Fixture
 *
 * Generated from DonationAttributionEntity and AttributionService schemas.
 * Version-tagged for drift detection.
 *
 * Consumer: DonorImpactController
 * Provider: AttributionService
 */

import { generateFixture, GeneratedFixture } from '../utils/fixture-generator';
import { createInteraction, createServiceContract } from '../utils/interaction-matcher';

/** Schema version — bump when entity fields change */
export const DONATION_ATTRIBUTION_SCHEMA_VERSION = '1.0.0';

export const DonationAttributionFixture: GeneratedFixture = generateFixture(
  'DonationAttribution',
  DONATION_ATTRIBUTION_SCHEMA_VERSION,
  {
    fields: {
      id: { type: 'uuid', example: 'attr-00000000-0000-0000-0000-000000000001' },
      correlationId: { type: 'string', example: 'ATTR-abc123' },
      donorId: { type: 'string', nullable: true, example: 'donor-uuid-001' },
      pledgeId: { type: 'uuid', nullable: true, example: null },
      donationId: { type: 'uuid', nullable: true, example: 'don-00000000-0000-0000-0000-000000000001' },
      bloodUnitId: { type: 'uuid', nullable: true, example: 'unit-00000000-0000-0000-0000-000000000001' },
      orderId: { type: 'uuid', nullable: true, example: 'ord-00000000-0000-0000-0000-000000000001' },
      beneficiaryId: { type: 'string', nullable: true, example: 'hospital-001' },
      attributionScore: { type: 'decimal', example: 1.0 },
      confidenceScore: { type: 'decimal', example: 1.0 },
      lineagePath: { type: 'array', example: [] },
      isPooled: { type: 'boolean', example: false },
      poolContributionPct: { type: 'decimal', nullable: true, example: null },
      outcomeEventId: { type: 'string', nullable: true, example: null },
      outcomeType: { type: 'string', nullable: true, example: null },
      metadata: { type: 'object', nullable: true, example: null },
      createdAt: { type: 'timestamp', example: '2026-01-01T00:00:00.000Z' },
    },
    required: [
      'id', 'correlationId', 'attributionScore', 'confidenceScore',
      'lineagePath', 'isPooled', 'createdAt',
    ],
  },
);

export const LineageGapFixture: GeneratedFixture = generateFixture(
  'LineageGap',
  DONATION_ATTRIBUTION_SCHEMA_VERSION,
  {
    fields: {
      id: { type: 'uuid', example: 'gap-00000000-0000-0000-0000-000000000001' },
      correlationId: { type: 'string', example: 'ATTR-abc123' },
      missingEventType: { type: 'string', example: 'delivery' },
      precedingEventId: { type: 'string', nullable: true, example: 'unit-001' },
      followingEventId: { type: 'string', nullable: true, example: null },
      confidenceScore: { type: 'decimal', example: 0.85 },
      gapReason: { type: 'string', nullable: true, example: 'No delivery event found in lineage path' },
      detectedAt: { type: 'timestamp', example: '2026-01-01T00:00:00.000Z' },
    },
    required: ['id', 'correlationId', 'missingEventType', 'confidenceScore', 'detectedAt'],
  },
);

export const AttributedImpactReportFixture: GeneratedFixture = generateFixture(
  'AttributedImpactReport',
  DONATION_ATTRIBUTION_SCHEMA_VERSION,
  {
    fields: {
      donorRef: { type: 'string', example: 'DONOR-ABCD****' },
      totalAttributedOutcomes: { type: 'number', example: 3 },
      attributions: { type: 'array', example: [] },
      lineageGaps: { type: 'array', example: [] },
      overallConfidence: { type: 'decimal', example: 0.9 },
    },
    required: ['donorRef', 'totalAttributedOutcomes', 'attributions', 'lineageGaps', 'overallConfidence'],
  },
);

/**
 * Contract interactions for the attribution API
 */
export const GetAttributedImpactInteraction = createInteraction(
  'Get attributed impact report',
  'DonorImpactController',
  'AttributionService',
  {
    method: 'GET',
    path: '/donor-impact/donor-uuid-001/attributed',
    headers: { Authorization: 'Bearer valid-jwt-token' },
  },
  {
    status: 200,
    body: AttributedImpactReportFixture.example,
  },
);

export const GetDrillDownEvidenceInteraction = createInteraction(
  'Get drill-down evidence for correlation ID',
  'DonorImpactController',
  'AttributionService',
  {
    method: 'GET',
    path: '/donor-impact/attribution/ATTR-abc123/evidence',
    headers: { Authorization: 'Bearer valid-jwt-token' },
  },
  {
    status: 200,
    body: {
      correlationId: 'ATTR-abc123',
      attribution: DonationAttributionFixture.example,
      gaps: [],
      evidenceRefs: {
        donationId: 'don-00000000-0000-0000-0000-000000000001',
        bloodUnitId: 'unit-00000000-0000-0000-0000-000000000001',
        orderId: 'ord-00000000-0000-0000-0000-000000000001',
      },
    },
  },
);

export const DonationAttributionContract = createServiceContract(
  'DonationAttribution',
  DONATION_ATTRIBUTION_SCHEMA_VERSION,
  [GetAttributedImpactInteraction, GetDrillDownEvidenceInteraction],
);
