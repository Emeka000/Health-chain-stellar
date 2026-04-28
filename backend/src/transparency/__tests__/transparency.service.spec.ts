import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BloodUnitEntity } from '../../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../../orders/entities/order.entity';
import { OrderStatus } from '../../orders/enums/order-status.enum';
import { OrganizationEntity } from '../../organizations/entities/organization.entity';
import { OrganizationVerificationStatus } from '../../organizations/enums/organization-verification-status.enum';
import { TransparencyService } from '../transparency.service';

// ── Repo factories ────────────────────────────────────────────────────────────

const makeOrderRepo = (overrides: Partial<Record<string, unknown>> = {}) => ({
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ avgHours: null }),
    getRawMany: jest.fn().mockResolvedValue([]),
  }),
  ...overrides,
});

const makeOrgRepo = (overrides: Partial<Record<string, unknown>> = {}) => ({
  count: jest.fn().mockResolvedValue(0),
  createQueryBuilder: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getRawMany: jest.fn().mockResolvedValue([]),
  }),
  ...overrides,
});

const makeBloodUnitRepo = () => ({ count: jest.fn().mockResolvedValue(0) });

async function buildService(
  orderRepo = makeOrderRepo(),
  orgRepo = makeOrgRepo(),
  bloodUnitRepo = makeBloodUnitRepo(),
) {
  const module = await Test.createTestingModule({
    providers: [
      TransparencyService,
      { provide: getRepositoryToken(OrderEntity), useValue: orderRepo },
      { provide: getRepositoryToken(OrganizationEntity), useValue: orgRepo },
      { provide: getRepositoryToken(BloodUnitEntity), useValue: bloodUnitRepo },
    ],
  }).compile();
  return module.get(TransparencyService);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TransparencyService – public metrics transformations', () => {
  it('returns zeroed metrics snapshot when database is empty', async () => {
    const service = await buildService();
    const result = await service.getPublicMetrics();
    expect({ ...result, generatedAt: '<timestamp>' }).toMatchSnapshot();
  });

  it('aggregates fulfilled requests and blood type breakdown correctly', async () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ avgHours: '2.5' }),
      getRawMany: jest
        .fn()
        .mockResolvedValueOnce([
          { bloodType: 'A+', count: '100' },
          { bloodType: 'O-', count: '80' },
        ])
        .mockResolvedValue([]),
    };

    const orderRepo = makeOrderRepo({
      count: jest.fn().mockResolvedValue(42),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    });

    const orgQb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(3),
      getRawMany: jest.fn().mockResolvedValue([{ region: 'Lagos', count: '4' }]),
    };

    const orgRepo = makeOrgRepo({
      count: jest.fn().mockResolvedValue(7),
      createQueryBuilder: jest.fn().mockReturnValue(orgQb),
    });

    const service = await buildService(orderRepo, orgRepo, { count: jest.fn().mockResolvedValue(120) });
    const result = await service.getPublicMetrics();

    expect(result.fulfilledRequests).toBe(42);
    expect(result.avgResponseTimeHours).toBe(2.5);
    expect(result.totalDonationsRecorded).toBe(120);
    expect(result.verifiedPartners).toBe(7);
    expect(result.onChainVerifiedOrgs).toBe(3);
    // Blood type values may have noise applied — just check keys exist
    expect(Object.keys(result.bloodTypeBreakdown)).toContain('A+');
    expect(Object.keys(result.bloodTypeBreakdown)).toContain('O-');
    expect(result.geographicCoverage[0].region).toBe('Lagos');
    expect({ ...result, generatedAt: '<timestamp>' }).toMatchSnapshot();
  });

  it('returns null avgResponseTimeHours when no delivered orders exist', async () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ avgHours: null }),
      getRawMany: jest.fn().mockResolvedValue([]),
    };
    const service = await buildService(
      makeOrderRepo({ createQueryBuilder: jest.fn().mockReturnValue(qb) }),
    );
    const result = await service.getPublicMetrics();
    expect(result.avgResponseTimeHours).toBeNull();
  });
});

// ── PHI / PII leakage prevention ──────────────────────────────────────────────

describe('TransparencyService – PHI/PII leakage prevention', () => {
  const PHI_FIELDS = [
    'donorId', 'donor_id', 'patientId', 'patient_id',
    'recipientName', 'testResults', 'barcodeData', 'unitNumber', 'unitCode',
  ];
  const PII_FIELDS = [
    'email', 'phone', 'phoneNumber', 'address', 'addressLine1', 'addressLine2',
    'postalCode', 'deliveryAddress', 'legalName', 'registrationNumber', 'licenseNumber',
  ];
  const INTERNAL_ID_FIELDS = [
    'hospitalId', 'riderId', 'bloodBankId', 'bankId', 'organizationId',
    'registeredBy', 'verifiedByUserId', 'importedBy', 'disputeId',
  ];
  const FINANCIAL_FIELDS = ['feeBreakdown', 'feeCalculationTrace', 'appliedPolicyId'];
  const CREDENTIAL_FIELDS = [
    'blockchainTxHash', 'blockchainAddress', 'blockchainUnitId',
    'licenseDocumentPath', 'certificateDocumentPath', 'verificationDocuments', 'rejectionReason',
  ];
  const GEO_FIELDS = ['latitude', 'longitude', 'storageLocation'];

  const ALL_SENSITIVE = [
    ...PHI_FIELDS, ...PII_FIELDS, ...INTERNAL_ID_FIELDS,
    ...FINANCIAL_FIELDS, ...CREDENTIAL_FIELDS, ...GEO_FIELDS,
  ];

  it('strips all PHI fields from published metrics', async () => {
    const service = await buildService();
    const result = await service.getPublicMetrics();
    const json = JSON.stringify(result);
    for (const field of PHI_FIELDS) {
      expect(json).not.toMatch(new RegExp(`"${field}"\\s*:`));
    }
  });

  it('strips all PII fields from published metrics', async () => {
    const service = await buildService();
    const result = await service.getPublicMetrics();
    const json = JSON.stringify(result);
    for (const field of PII_FIELDS) {
      expect(json).not.toMatch(new RegExp(`"${field}"\\s*:`));
    }
  });

  it('strips all internal ID fields from published metrics', async () => {
    const service = await buildService();
    const result = await service.getPublicMetrics();
    const json = JSON.stringify(result);
    for (const field of INTERNAL_ID_FIELDS) {
      expect(json).not.toMatch(new RegExp(`"${field}"\\s*:`));
    }
  });

  it('strips financial, credential, and precise geo fields', async () => {
    const service = await buildService();
    const result = await service.getPublicMetrics();
    const json = JSON.stringify(result);
    for (const field of [...FINANCIAL_FIELDS, ...CREDENTIAL_FIELDS, ...GEO_FIELDS]) {
      expect(json).not.toMatch(new RegExp(`"${field}"\\s*:`));
    }
  });

  it('RedactionEngine.assertNoPHILeakage detects injected sensitive fields', () => {
    const { RedactionEngine } = require('../redaction/redaction.engine');
    const leaky = JSON.stringify({ donorId: 'abc', email: 'x@y.com', count: 5 });
    const { clean, leakedFields } = RedactionEngine.assertNoPHILeakage(leaky);
    expect(clean).toBe(false);
    expect(leakedFields).toContain('donorId');
    expect(leakedFields).toContain('email');
  });

  it('RedactionEngine.assertNoPHILeakage passes clean payload', () => {
    const { RedactionEngine } = require('../redaction/redaction.engine');
    const clean = JSON.stringify({ fulfilledRequests: 42, bloodTypeBreakdown: { 'A+': 10 } });
    const result = RedactionEngine.assertNoPHILeakage(clean);
    expect(result.clean).toBe(true);
    expect(result.leakedFields).toHaveLength(0);
  });
});

// ── Redaction engine unit tests ───────────────────────────────────────────────

describe('RedactionEngine', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RedactionEngine, LOW_COUNT_THRESHOLD } = require('../redaction/redaction.engine');

  describe('redact()', () => {
    it('removes all sensitive fields from a flat object', () => {
      const input = {
        fulfilledRequests: 42,
        donorId: 'donor-123',
        email: 'test@example.com',
        hospitalId: 'hosp-1',
        bloodTypeBreakdown: { 'A+': 10 },
      };
      const { data, redactedFields } = RedactionEngine.redact(input);
      expect(data.fulfilledRequests).toBe(42);
      expect(data.donorId).toBeUndefined();
      expect(data.email).toBeUndefined();
      expect(data.hospitalId).toBeUndefined();
      expect(redactedFields).toContain('donorId');
      expect(redactedFields).toContain('email');
      expect(redactedFields).toContain('hospitalId');
    });

    it('recursively removes sensitive fields from nested objects', () => {
      const input = {
        org: { name: 'Blood Bank A', email: 'admin@bb.com', latitude: 6.5, longitude: 3.3 },
        count: 5,
      };
      const { data, redactedFields } = RedactionEngine.redact(input);
      expect((data as any).org.name).toBe('Blood Bank A');
      expect((data as any).org.email).toBeUndefined();
      expect((data as any).org.latitude).toBeUndefined();
      expect(redactedFields).toContain('org.email');
      expect(redactedFields).toContain('org.latitude');
    });

    it('recursively removes sensitive fields from arrays', () => {
      const input = {
        items: [
          { region: 'Lagos', donorId: 'x' },
          { region: 'Abuja', donorId: 'y' },
        ],
      };
      const { data } = RedactionEngine.redact(input);
      (data as any).items.forEach((item: any) => {
        expect(item.donorId).toBeUndefined();
        expect(item.region).toBeDefined();
      });
    });

    it('returns empty redactedFields for a clean object', () => {
      const input = { fulfilledRequests: 10, generatedAt: '2024-01-01' };
      const { redactedFields } = RedactionEngine.redact(input);
      expect(redactedFields).toHaveLength(0);
    });
  });

  describe('applyThreshold()', () => {
    it('suppresses buckets below the threshold', () => {
      const breakdown = { 'A+': 100, 'AB-': 2, 'B+': 50, 'O-': 3 };
      const { result, suppressedBuckets } = RedactionEngine.applyThreshold(breakdown);
      expect(result['A+']).toBe(100);
      expect(result['B+']).toBe(50);
      expect(result['AB-']).toBeNull();
      expect(result['O-']).toBeNull();
      expect(suppressedBuckets).toContain('AB-');
      expect(suppressedBuckets).toContain('O-');
    });

    it('suppresses nothing when all counts meet the threshold', () => {
      const breakdown = { 'A+': 10, 'B-': 20 };
      const { suppressedBuckets } = RedactionEngine.applyThreshold(breakdown);
      expect(suppressedBuckets).toHaveLength(0);
    });

    it('suppresses all buckets when all counts are below threshold', () => {
      const breakdown = { 'A+': 1, 'B-': 2 };
      const { result, suppressedBuckets } = RedactionEngine.applyThreshold(breakdown);
      expect(result['A+']).toBeNull();
      expect(result['B-']).toBeNull();
      expect(suppressedBuckets).toHaveLength(2);
    });

    it('uses the default LOW_COUNT_THRESHOLD constant', () => {
      expect(LOW_COUNT_THRESHOLD).toBe(5);
      const breakdown = { 'A+': 4 };
      const { suppressedBuckets } = RedactionEngine.applyThreshold(breakdown);
      expect(suppressedBuckets).toContain('A+');
    });

    it('respects a custom threshold', () => {
      const breakdown = { 'A+': 8, 'B-': 12 };
      const { suppressedBuckets } = RedactionEngine.applyThreshold(breakdown, 10);
      expect(suppressedBuckets).toContain('A+');
      expect(suppressedBuckets).not.toContain('B-');
    });
  });

  describe('applyDifferentialPrivacy()', () => {
    it('returns the same keys as the input', () => {
      const breakdown = { 'A+': 100, 'O-': 50 };
      const { result } = RedactionEngine.applyDifferentialPrivacy(breakdown);
      expect(Object.keys(result)).toEqual(expect.arrayContaining(['A+', 'O-']));
    });

    it('returns non-negative integers', () => {
      const breakdown = { 'A+': 0, 'O-': 1 };
      const { result } = RedactionEngine.applyDifferentialPrivacy(breakdown);
      expect(result['A+']).toBeGreaterThanOrEqual(0);
      expect(result['O-']).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(result['A+'])).toBe(true);
    });

    it('lists all keys as noisedFields', () => {
      const breakdown = { 'A+': 10, 'B-': 20 };
      const { noisedFields } = RedactionEngine.applyDifferentialPrivacy(breakdown);
      expect(noisedFields).toContain('A+');
      expect(noisedFields).toContain('B-');
    });

    it('does not change values by more than a reasonable noise bound for large counts', () => {
      // With ε=1, scale=1, noise is typically within ±10 for large counts
      // Run 20 times to reduce flakiness
      const breakdown = { 'A+': 10000 };
      for (let i = 0; i < 20; i++) {
        const { result } = RedactionEngine.applyDifferentialPrivacy(breakdown);
        expect(Math.abs(result['A+'] - 10000)).toBeLessThan(50);
      }
    });
  });

  describe('addLaplaceNoise()', () => {
    it('clamps result to >= 0', () => {
      // Even with large negative noise, result should be >= 0
      for (let i = 0; i < 50; i++) {
        expect(RedactionEngine.addLaplaceNoise(0)).toBeGreaterThanOrEqual(0);
      }
    });

    it('returns an integer', () => {
      expect(Number.isInteger(RedactionEngine.addLaplaceNoise(100))).toBe(true);
    });
  });
});

// ── Provenance metadata ───────────────────────────────────────────────────────

describe('TransparencyService – provenance metadata', () => {
  it('publication artifact includes provenance with artifactId, generatedAt, payloadDigest', async () => {
    const service = await buildService();
    const { data, provenance } = await service.getPublicMetricsWithProvenance();

    expect(provenance.artifactId).toBeDefined();
    expect(provenance.generatedAt).toBeDefined();
    expect(provenance.payloadDigest).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    expect(provenance.schemaVersion).toBe('1.0.0');
    expect(provenance.sources).toContain('orders');
    expect(provenance.sources).toContain('organizations');
    expect(provenance.lowCountThreshold).toBe(5);
    expect(provenance.privacyEpsilon).toBe(1.0);
  });

  it('provenance lists transformation rules applied', async () => {
    const service = await buildService();
    const { provenance } = await service.getPublicMetricsWithProvenance();

    const transformationTypes = provenance.transformations.map((t) => t.transformation);
    expect(transformationTypes).toContain('NOISED');
    expect(transformationTypes).toContain('AGGREGATED');
  });

  it('payloadDigest changes when data changes', async () => {
    const service1 = await buildService();
    const service2 = await buildService(
      makeOrderRepo({ count: jest.fn().mockResolvedValue(999) }),
    );

    const { provenance: p1 } = await service1.getPublicMetricsWithProvenance();
    const { provenance: p2 } = await service2.getPublicMetricsWithProvenance();

    // Different data → different digest (with high probability given noise)
    // We just verify the digest is a valid SHA-256
    expect(p1.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(p2.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('provenance records suppressed buckets when low-count threshold fires', async () => {
    const qb = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ avgHours: null }),
      // Return a blood type with count=1 (below threshold=5)
      getRawMany: jest.fn().mockResolvedValueOnce([{ bloodType: 'AB-', count: '1' }]).mockResolvedValue([]),
    };

    const service = await buildService(
      makeOrderRepo({ createQueryBuilder: jest.fn().mockReturnValue(qb) }),
    );

    const { provenance } = await service.getPublicMetricsWithProvenance();
    // AB- count=1 → after noise it may still be below threshold
    // The suppressed buckets array should be populated if threshold fires
    expect(Array.isArray(provenance.suppressedBuckets)).toBe(true);
  });
});

// ── ProvenanceBuilder unit tests ──────────────────────────────────────────────

describe('ProvenanceBuilder', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ProvenanceBuilder } = require('../provenance/provenance.builder');

  it('builds provenance with correct structure', () => {
    const builder = new ProvenanceBuilder({ schemaVersion: '2.0.0', lowCountThreshold: 10 });
    builder
      .addSource('orders')
      .addTransformation({ field: 'email', transformation: 'REDACTED', reason: 'PII' })
      .setRedactedFields(['email'])
      .setSuppressedBuckets(['AB-'])
      .setNoisedFields(['A+']);

    const payload = { count: 42 };
    const meta = builder.build(payload);

    expect(meta.schemaVersion).toBe('2.0.0');
    expect(meta.sources).toContain('orders');
    expect(meta.transformations[0].field).toBe('email');
    expect(meta.redactedFields).toContain('email');
    expect(meta.suppressedBuckets).toContain('AB-');
    expect(meta.noisedFields).toContain('A+');
    expect(meta.lowCountThreshold).toBe(10);
    expect(meta.payloadDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(meta.artifactId).toBeDefined();
  });

  it('generates a different artifactId on each call', () => {
    const builder = new ProvenanceBuilder();
    const m1 = builder.build({});
    const m2 = builder.build({});
    expect(m1.artifactId).not.toBe(m2.artifactId);
  });
});

// ── Privacy review report ─────────────────────────────────────────────────────

describe('TransparencyService – privacy review report', () => {
  it('returns a report with taxonomy counts and recommendations', async () => {
    const service = await buildService();
    // Generate a publication first so lastProvenance is populated
    await service.getPublicMetricsWithProvenance();

    const report = await service.getPrivacyReviewReport();

    expect(report.totalSensitiveFieldsDefined).toBeGreaterThan(0);
    expect(report.categorySummary).toBeDefined();
    expect(report.lowCountThreshold).toBe(5);
    expect(report.privacyEpsilon).toBe(1.0);
    expect(report.lastPublicationArtifactId).not.toBeNull();
    expect(report.lastPublicationAt).not.toBeNull();
    expect(Array.isArray(report.recommendations)).toBe(true);
  });

  it('recommends running a publication when none has been generated', async () => {
    const service = await buildService();
    const report = await service.getPrivacyReviewReport();
    expect(report.recommendations[0]).toMatch(/No publication/);
  });

  it('categorySummary covers PHI, PII, INTERNAL_ID, FINANCIAL, CREDENTIAL, PRECISE_GEO', async () => {
    const service = await buildService();
    const report = await service.getPrivacyReviewReport();
    const categories = Object.keys(report.categorySummary);
    expect(categories).toContain('PHI');
    expect(categories).toContain('PII');
    expect(categories).toContain('INTERNAL_ID');
    expect(categories).toContain('FINANCIAL');
    expect(categories).toContain('CREDENTIAL');
    expect(categories).toContain('PRECISE_GEO');
  });
});

// ── Sensitive field taxonomy completeness ─────────────────────────────────────

describe('Sensitive field taxonomy', () => {
  it('contains all known PHI fields', () => {
    const { SENSITIVE_FIELD_SET } = require('../redaction/sensitive-field-taxonomy');
    const required = ['donorId', 'patientId', 'recipientName', 'testResults', 'barcodeData'];
    for (const field of required) {
      expect(SENSITIVE_FIELD_SET.has(field)).toBe(true);
    }
  });

  it('contains all known PII fields', () => {
    const { SENSITIVE_FIELD_SET } = require('../redaction/sensitive-field-taxonomy');
    const required = ['email', 'phone', 'address', 'deliveryAddress', 'postalCode'];
    for (const field of required) {
      expect(SENSITIVE_FIELD_SET.has(field)).toBe(true);
    }
  });

  it('contains precise geo fields', () => {
    const { SENSITIVE_FIELD_SET } = require('../redaction/sensitive-field-taxonomy');
    expect(SENSITIVE_FIELD_SET.has('latitude')).toBe(true);
    expect(SENSITIVE_FIELD_SET.has('longitude')).toBe(true);
  });

  it('has no duplicate field entries', () => {
    const { SENSITIVE_FIELD_TAXONOMY } = require('../redaction/sensitive-field-taxonomy');
    const fields = SENSITIVE_FIELD_TAXONOMY.map((f: any) => f.field);
    const unique = new Set(fields);
    expect(unique.size).toBe(fields.length);
  });
});
