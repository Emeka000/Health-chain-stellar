/**
 * Fixture Drift Detector
 *
 * Compares stored fixture schemas against runtime serializer output.
 * Detects field additions, removals, and type changes before merge.
 */

import { GeneratedFixture } from './fixture-generator';

export interface DriftReport {
  fixtureName: string;
  fixtureVersion: string;
  hasDrift: boolean;
  addedFields: string[];
  removedFields: string[];
  typeChanges: { field: string; fixtureType: string; runtimeType: string }[];
  newRequiredFields: string[];
  removedRequiredFields: string[];
  generatedAt: string;
}

/**
 * Detect drift between a stored fixture and a runtime serialized payload.
 *
 * @param fixture - The stored canonical fixture
 * @param runtimePayload - A live serialized payload from the runtime serializer
 */
export function detectDrift(
  fixture: GeneratedFixture,
  runtimePayload: Record<string, any>,
): DriftReport {
  const fixtureFields = new Set(Object.keys(fixture.schema.fields));
  const runtimeFields = new Set(Object.keys(runtimePayload));

  const addedFields = [...runtimeFields].filter((f) => !fixtureFields.has(f));
  const removedFields = [...fixtureFields].filter((f) => !runtimeFields.has(f));

  const typeChanges: DriftReport['typeChanges'] = [];
  for (const field of fixtureFields) {
    if (!runtimeFields.has(field)) continue;
    const fixtureType = fixture.schema.fields[field].type;
    const runtimeType = inferType(runtimePayload[field]);
    if (fixtureType !== runtimeType) {
      typeChanges.push({ field, fixtureType, runtimeType });
    }
  }

  // Detect required field changes
  const fixtureRequired = new Set(fixture.schema.required);
  const runtimeRequired = new Set(
    Object.keys(runtimePayload).filter((k) => runtimePayload[k] !== null && runtimePayload[k] !== undefined),
  );

  const newRequiredFields = [...runtimeRequired].filter((f) => !fixtureRequired.has(f) && fixtureFields.has(f));
  const removedRequiredFields = [...fixtureRequired].filter((f) => !runtimeRequired.has(f) && runtimeFields.has(f));

  const hasDrift =
    addedFields.length > 0 ||
    removedFields.length > 0 ||
    typeChanges.length > 0 ||
    newRequiredFields.length > 0 ||
    removedRequiredFields.length > 0;

  return {
    fixtureName: fixture.sourceName,
    fixtureVersion: fixture.schemaVersion,
    hasDrift,
    addedFields,
    removedFields,
    typeChanges,
    newRequiredFields,
    removedRequiredFields,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Format a drift report as a human-readable diff for reviewer visibility.
 */
export function formatDriftReport(report: DriftReport): string {
  if (!report.hasDrift) {
    return `✓ No drift detected in fixture '${report.fixtureName}' v${report.fixtureVersion}`;
  }

  const lines: string[] = [
    `⚠ Drift detected in fixture '${report.fixtureName}' v${report.fixtureVersion}:`,
  ];

  if (report.addedFields.length > 0) {
    lines.push(`  + Added fields: ${report.addedFields.join(', ')}`);
  }
  if (report.removedFields.length > 0) {
    lines.push(`  - Removed fields: ${report.removedFields.join(', ')}`);
  }
  for (const tc of report.typeChanges) {
    lines.push(`  ~ Type change: '${tc.field}' ${tc.fixtureType} → ${tc.runtimeType}`);
  }
  if (report.newRequiredFields.length > 0) {
    lines.push(`  + New required fields: ${report.newRequiredFields.join(', ')}`);
  }
  if (report.removedRequiredFields.length > 0) {
    lines.push(`  - Removed required fields: ${report.removedRequiredFields.join(', ')}`);
  }

  return lines.join('\n');
}

function inferType(value: any): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'timestamp';
  if (typeof value === 'string' && isIsoDate(value)) return 'timestamp';
  if (typeof value === 'string' && isUuid(value)) return 'uuid';
  return typeof value;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s);
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
