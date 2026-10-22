/**
 * Fixture Drift Detection Tests
 *
 * These tests fail fast when fixture schemas diverge from runtime serializers.
 * Run before merge to catch stale fixture structures.
 *
 * Acceptance criteria:
 * - Fixture drift is detected before merge
 * - Fixtures carry explicit schema version metadata
 * - Generated fixtures are reproducible from source definitions
 * - Contract tests fail fast on stale fixture structures
 */

import { detectDrift, formatDriftReport } from '../utils/fixture-drift-detector';
import {
  validatePayloadAgainstFixture,
  generateFixture,
} from '../utils/fixture-generator';
import {
  DonationEntityFixture,
  PledgeEntityFixture,
  DONATION_SCHEMA_VERSION,
} from './donation.fixture';
import {
  DonationAttributionFixture,
  LineageGapFixture,
  AttributedImpactReportFixture,
  DONATION_ATTRIBUTION_SCHEMA_VERSION,
} from './donation-attribution.fixture';

// ---------------------------------------------------------------------------
// Fixture metadata
// ---------------------------------------------------------------------------

describe('Fixture metadata', () => {
  const allFixtures = [
    DonationEntityFixture,
    PledgeEntityFixture,
    DonationAttributionFixture,
    LineageGapFixture,
    AttributedImpactReportFixture,
  ];

  it.each(allFixtures)('$sourceName carries schemaVersion', (fixture) => {
    expect(fixture.schemaVersion).toBeDefined();
    expect(typeof fixture.schemaVersion).toBe('string');
    expect(fixture.schemaVersion.length).toBeGreaterThan(0);
  });

  it.each(allFixtures)('$sourceName carries generatedAt timestamp', (fixture) => {
    expect(fixture.generatedAt).toBeDefined();
    expect(new Date(fixture.generatedAt).getTime()).not.toBeNaN();
  });

  it.each(allFixtures)('$sourceName carries provenance metadata', (fixture) => {
    expect(fixture.provenance).toBeDefined();
    expect(fixture.provenance.generatedFrom).toBe(fixture.sourceName);
    expect(fixture.provenance.generatorVersion).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Reproducibility: regenerating from source produces same schema
// ---------------------------------------------------------------------------

describe('Fixture reproducibility', () => {
  it('DonationEntity fixture is reproducible from source schema', () => {
    const regenerated = generateFixture(
      'DonationEntity',
      DONATION_SCHEMA_VERSION,
      DonationEntityFixture.schema,
    );

    expect(regenerated.schema).toEqual(DonationEntityFixture.schema);
    expect(regenerated.schemaVersion).toBe(DonationEntityFixture.schemaVersion);
    expect(regenerated.sourceName).toBe(DonationEntityFixture.sourceName);
  });

  it('DonationAttribution fixture is reproducible from source schema', () => {
    const regenerated = generateFixture(
      'DonationAttribution',
      DONATION_ATTRIBUTION_SCHEMA_VERSION,
      DonationAttributionFixture.schema,
    );

    expect(regenerated.schema).toEqual(DonationAttributionFixture.schema);
  });
});

// ---------------------------------------------------------------------------
// Drift detection: no drift on matching payloads
// ---------------------------------------------------------------------------

describe('Drift detection — no drift', () => {
  it('detects no drift when runtime payload matches DonationEntity fixture', () => {
    const runtimePayload = { ...DonationEntityFixture.example };
    const report = detectDrift(DonationEntityFixture, runtimePayload);

    expect(report.hasDrift).toBe(false);
    expect(report.addedFields).toHaveLength(0);
    expect(report.removedFields).toHaveLength(0);
    expect(report.typeChanges).toHaveLength(0);
  });

  it('detects no drift when runtime payload matches DonationAttribution fixture', () => {
    const runtimePayload = { ...DonationAttributionFixture.example };
    const report = detectDrift(DonationAttributionFixture, runtimePayload);

    expect(report.hasDrift).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Drift detection: added fields
// ---------------------------------------------------------------------------

describe('Drift detection — added fields', () => {
  it('detects added field in runtime payload', () => {
    const runtimePayload = {
      ...DonationEntityFixture.example,
      newUnknownField: 'surprise',
    };

    const report = detectDrift(DonationEntityFixture, runtimePayload);

    expect(report.hasDrift).toBe(true);
    expect(report.addedFields).toContain('newUnknownField');
  });
});

// ---------------------------------------------------------------------------
// Drift detection: removed fields
// ---------------------------------------------------------------------------

describe('Drift detection — removed fields', () => {
  it('detects removed field from runtime payload', () => {
    const runtimePayload = { ...DonationEntityFixture.example };
    delete runtimePayload['memo'];

    const report = detectDrift(DonationEntityFixture, runtimePayload);

    expect(report.hasDrift).toBe(true);
    expect(report.removedFields).toContain('memo');
  });
});

// ---------------------------------------------------------------------------
// Drift detection: type changes
// ---------------------------------------------------------------------------

describe('Drift detection — type changes', () => {
  it('detects type change from decimal to string', () => {
    const runtimePayload = {
      ...DonationEntityFixture.example,
      amount: 'one-hundred', // was decimal
    };

    const report = detectDrift(DonationEntityFixture, runtimePayload);

    expect(report.hasDrift).toBe(true);
    expect(report.typeChanges.some((tc) => tc.field === 'amount')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Payload validation: required fields
// ---------------------------------------------------------------------------

describe('Payload validation — required fields', () => {
  it('fails validation when required field is missing', () => {
    const payload = { ...DonationEntityFixture.example };
    delete payload['memo'];

    const result = validatePayloadAgainstFixture(payload, DonationEntityFixture);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('memo') && e.includes('MISSING_REQUIRED'))).toBe(true);
  });

  it('passes validation for a complete valid payload', () => {
    const result = validatePayloadAgainstFixture(DonationEntityFixture.example, DonationEntityFixture);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Payload validation: unknown fields
// ---------------------------------------------------------------------------

describe('Payload validation — unknown fields', () => {
  it('fails validation when unknown field is present', () => {
    const payload = {
      ...DonationEntityFixture.example,
      unknownField: 'should-not-be-here',
    };

    const result = validatePayloadAgainstFixture(payload, DonationEntityFixture);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknownField') && e.includes('UNKNOWN_FIELD'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Payload validation: enum violations
// ---------------------------------------------------------------------------

describe('Payload validation — enum violations', () => {
  it('fails validation when enum field has invalid value', () => {
    const payload = {
      ...DonationEntityFixture.example,
      status: 'INVALID_STATUS',
    };

    const result = validatePayloadAgainstFixture(payload, DonationEntityFixture);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('status') && e.includes('ENUM_VIOLATION'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Drift report formatting
// ---------------------------------------------------------------------------

describe('Drift report formatting', () => {
  it('formats no-drift report correctly', () => {
    const report = detectDrift(DonationEntityFixture, { ...DonationEntityFixture.example });
    const formatted = formatDriftReport(report);

    expect(formatted).toContain('No drift detected');
    expect(formatted).toContain('DonationEntity');
  });

  it('formats drift report with added/removed fields', () => {
    const runtimePayload = { ...DonationEntityFixture.example };
    delete runtimePayload['memo'];
    (runtimePayload as any).newField = 'value';

    const report = detectDrift(DonationEntityFixture, runtimePayload);
    const formatted = formatDriftReport(report);

    expect(formatted).toContain('Drift detected');
    expect(formatted).toContain('newField');
    expect(formatted).toContain('memo');
  });
});
