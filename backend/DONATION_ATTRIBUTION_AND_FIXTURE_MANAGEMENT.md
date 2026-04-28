# Donation Attribution & Contract Test Fixture Management

## Overview

This document describes the implementation of two interconnected features:

1. **Donation Attribution & Impact Lineage** — Causal linkage from pledged funds to concrete healthcare outcomes
2. **Contract Test Fixture Management** — Schema-versioned fixtures with drift detection

## Feature A: Donation Attribution & Impact Lineage

### Problem Statement

Donation and donor impact modules previously lacked strong causal linkage from pledged funds to concrete healthcare outcomes. Donors could not trace their contributions through the full chain of events to see the actual impact.

### Solution

Implemented an attribution graph system that connects:
- **Pledge** → **Donation** → **Allocation** (blood unit) → **Delivery** (order) → **Beneficiary** (hospital/patient)

### Architecture

#### Entities

**DonationAttributionEntity** (`src/donor-impact/entities/donation-attribution.entity.ts`)
- Tracks the complete attribution graph
- Stores correlation IDs for linking related events
- Includes attribution scores for partial fulfillment
- Includes confidence scores for incomplete lineage
- Supports pooled donations with contribution percentages

**LineageGapEntity** (`src/donor-impact/entities/lineage-gap.entity.ts`)
- Records gaps in the attribution chain
- Provides confidence indicators for missing segments
- Tracks preceding and following events around gaps

#### Services

**AttributionService** (`src/donor-impact/attribution.service.ts`)
- Core attribution logic
- Computes attribution scores for partial/pooled donations
- Detects lineage gaps and applies confidence penalties
- Provides idempotent upsert for replay stability
- Generates deterministic correlation IDs

**DonorImpactService** (`src/donor-impact/donor-impact.service.ts`)
- Enhanced with attribution reporting
- Provides `getAttributedImpactReport()` for full causal lineage
- Provides `getDrillDownEvidence()` for detailed evidence references
- Maintains backward compatibility with existing impact summaries

#### API Endpoints

```
GET /donor-impact/:donorId/attributed
```
Returns full attributed impact report with:
- Total attributed outcomes
- Attribution summaries with scores
- Lineage gaps with confidence indicators
- Overall confidence score

```
GET /donor-impact/attribution/:correlationId/evidence
```
Returns drill-down evidence for a specific attribution:
- Full attribution entity
- All detected gaps
- Evidence references (pledge, donation, blood unit, order, beneficiary)

### Attribution Scoring

**Attribution Score** (0-1):
- For single-donor contributions: 1.0
- For pooled donations: `poolContributionPct / 100`
- Capped at 1.0 for contributions over 100%

**Confidence Score** (0-1):
- Starts at 1.0 for complete lineage
- Penalty of 0.15 per missing lineage segment
- Minimum of 0.0

**Expected Lineage Sequence**:
1. Pledge (optional for one-time donations)
2. Donation
3. Allocation (blood unit assignment)
4. Delivery (order fulfillment)
5. Beneficiary (hospital/patient outcome)

### Replay Stability

Attribution records are idempotent on `correlationId`:
- Deterministic correlation IDs generated from available identifiers
- `upsertAttribution()` returns existing record on replay
- Ensures consistent results across event replay scenarios

### Tests

**attribution.service.spec.ts**
- Complete lineage scoring
- Gap detection and confidence penalties
- Pooled donation attribution
- Split delivery scenarios
- Merged funding paths
- Replay stability

## Feature B: Contract Test Fixture Management

### Problem Statement

Contract test fixtures could diverge from real payloads as modules evolve, reducing confidence in compatibility and cross-service integration.

### Solution

Implemented a fixture generation and drift detection system that:
- Generates fixtures from canonical DTO/entity schemas
- Validates fixtures against runtime serializers
- Detects drift before merge
- Provides reviewer-visible diffs
- Stores provenance metadata

### Architecture

#### Utilities

**fixture-generator.ts** (`src/contract-tests/utils/fixture-generator.ts`)
- Generates canonical fixtures from schema definitions
- Builds example payloads with type-appropriate defaults
- Validates runtime payloads against fixture schemas
- Detects missing required fields and unknown fields

**fixture-drift-detector.ts** (`src/contract-tests/utils/fixture-drift-detector.ts`)
- Compares stored fixtures against runtime payloads
- Detects added/removed fields
- Detects type changes
- Detects required field changes
- Formats human-readable drift reports

#### Fixture Structure

```typescript
interface GeneratedFixture {
  schemaVersion: string;        // Explicit version tag
  generatedAt: string;          // Generation timestamp
  sourceName: string;           // Source entity/DTO name
  schema: FixtureSchema;        // Field definitions
  example: Record<string, any>; // Example payload
  provenance: {
    generatedFrom: string;      // Source reference
    generatorVersion: string;   // Generator version
  };
}
```

#### Canonical Fixtures

**donation.fixture.ts**
- DonationEntity fixture (v1.0.0)
- PledgeEntity fixture (v1.0.0)
- Contract interactions for donation API

**donation-attribution.fixture.ts**
- DonationAttribution fixture (v1.0.0)
- LineageGap fixture (v1.0.0)
- AttributedImpactReport fixture (v1.0.0)
- Contract interactions for attribution API

### Drift Detection Workflow

1. **Generate Fixture**: Create canonical fixture from schema
2. **Serialize Runtime**: Get actual payload from runtime serializer
3. **Detect Drift**: Compare fixture schema vs runtime payload
4. **Report**: Generate reviewer-visible diff
5. **Fail Fast**: Tests fail on stale fixture structures

### Tests

**fixture-drift.spec.ts**
- Fixture metadata validation (version, timestamp, provenance)
- Reproducibility from source schemas
- No-drift detection for matching payloads
- Added field detection
- Removed field detection
- Type change detection
- Required field validation
- Unknown field validation
- Enum violation detection
- Drift report formatting

### Usage Example

```typescript
import { generateFixture } from './utils/fixture-generator';
import { detectDrift } from './utils/fixture-drift-detector';

// Generate fixture from schema
const fixture = generateFixture('MyEntity', '1.0.0', {
  fields: {
    id: { type: 'uuid' },
    name: { type: 'string' },
    status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] },
  },
  required: ['id', 'name', 'status'],
});

// Detect drift against runtime payload
const runtimePayload = myService.serialize(entity);
const report = detectDrift(fixture, runtimePayload);

if (report.hasDrift) {
  console.error(formatDriftReport(report));
  throw new Error('Fixture drift detected!');
}
```

## Acceptance Criteria

### Feature A: Donation Attribution

✅ Donor impact reports can trace contributions to outcome events
- `getAttributedImpactReport()` returns full attribution chain
- Each attribution includes lineage path with event references

✅ Partial and pooled funding attribution is correctly represented
- Attribution scores computed from pool contribution percentages
- Split deliveries tracked with separate attributions

✅ Lineage gaps are explicitly surfaced with confidence indicators
- LineageGapEntity records missing events
- Confidence scores penalized by 0.15 per gap
- Gap reasons provided for debugging

✅ Attribution results are stable across replay
- Deterministic correlation IDs
- Idempotent upsert operations
- Consistent scoring logic

### Feature B: Contract Test Fixtures

✅ Fixture drift is detected before merge into main development branch
- `detectDrift()` compares fixture vs runtime
- Tests fail on added/removed/changed fields

✅ Fixtures carry explicit schema version metadata
- `schemaVersion` field on all fixtures
- Version bumped when schema changes

✅ Generated fixtures remain reproducible from source definitions
- `generateFixture()` produces consistent output
- Provenance metadata tracks source

✅ Contract tests fail fast on stale fixture structures
- Validation detects unknown fields
- Validation detects missing required fields
- Enum violations caught

## Database Migrations

New tables created:
- `donation_attributions` — Attribution graph records
- `lineage_gaps` — Lineage gap records

Indexes:
- `donation_attributions.correlation_id`
- `donation_attributions.donor_id`
- `donation_attributions.pledge_id`
- `donation_attributions.donation_id`
- `lineage_gaps.correlation_id`

## Running Tests

```bash
# Run attribution tests
npm test -- attribution.service.spec

# Run fixture drift tests
npm test -- fixture-drift.spec

# Run all contract tests
npm run test:contracts
```

## Future Enhancements

1. **Real-time Attribution**: Stream attribution events as they occur
2. **Attribution Analytics**: Aggregate attribution data for insights
3. **Automated Fixture Regeneration**: CI workflow to regenerate fixtures on schema changes
4. **Visual Lineage Explorer**: UI for exploring attribution graphs
5. **Multi-hop Attribution**: Support for complex multi-step funding chains

## References

- [Donor Impact Module](./src/donor-impact/)
- [Contract Tests](./src/contract-tests/)
- [Attribution Service](./src/donor-impact/attribution.service.ts)
- [Fixture Generator](./src/contract-tests/utils/fixture-generator.ts)
- [Drift Detector](./src/contract-tests/utils/fixture-drift-detector.ts)
