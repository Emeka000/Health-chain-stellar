import { createSnapshot } from '../contract-tests/utils/schema-snapshot.matcher';
import {
  assertNoUnapprovedBreaks,
  BreakingChangeOverride,
  diffSnapshots,
} from '../contract-tests/utils/schema-diff';

describe('[CONTRACT] Schema Breaking-Change Detector', () => {
  const baseData = {
    id: 'BR-001',
    status: 'PENDING',
    amount: 100,
    items: [{ bloodType: 'A+', quantity: 5 }],
    meta: { urgent: true, notes: 'test' },
  };

  const baseSnapshot = createSnapshot('BloodRequest', '1.0.0', baseData);

  // ── Additive changes ──────────────────────────────────────────────────

  it('should classify new optional field as ADDITIVE', () => {
    const newData = { ...baseData, newOptionalField: 'value' };
    const newSnapshot = createSnapshot('BloodRequest', '1.1.0', newData);

    const result = diffSnapshots(baseSnapshot, newSnapshot);

    expect(result.hasBreakingChanges).toBe(false);
    const additive = result.changes.filter((c) => c.severity === 'ADDITIVE');
    expect(additive.some((c) => c.path.includes('newOptionalField'))).toBe(true);
  });

  // ── Breaking: field removed ───────────────────────────────────────────

  it('should detect BREAKING when a field is removed', () => {
    const { amount: _removed, ...withoutAmount } = baseData;
    const newSnapshot = createSnapshot('BloodRequest', '2.0.0', withoutAmount);

    const result = diffSnapshots(baseSnapshot, newSnapshot);

    expect(result.hasBreakingChanges).toBe(true);
    const breaking = result.changes.filter((c) => c.severity === 'BREAKING');
    expect(breaking.some((c) => c.path.includes('amount'))).toBe(true);
    expect(result.migrationNotes.some((n) => n.includes('amount'))).toBe(true);
  });

  // ── Breaking: type change ─────────────────────────────────────────────

  it('should detect BREAKING when a field type changes', () => {
    const newData = { ...baseData, amount: 'one-hundred' }; // number → string
    const newSnapshot = createSnapshot('BloodRequest', '2.0.0', newData);

    const result = diffSnapshots(baseSnapshot, newSnapshot);

    expect(result.hasBreakingChanges).toBe(true);
    const typeChange = result.changes.find(
      (c) => c.severity === 'BREAKING' && c.path.includes('amount'),
    );
    expect(typeChange).toBeDefined();
    expect(typeChange!.description).toMatch(/number.*string/);
  });

  // ── Breaking: nested object field removed ────────────────────────────

  it('should detect BREAKING for nested object field removal', () => {
    const newData = { ...baseData, meta: { urgent: true } }; // notes removed
    const newSnapshot = createSnapshot('BloodRequest', '2.0.0', newData);

    const result = diffSnapshots(baseSnapshot, newSnapshot);

    expect(result.hasBreakingChanges).toBe(true);
    expect(result.changes.some((c) => c.path.includes('meta') && c.path.includes('notes'))).toBe(true);
  });

  // ── Breaking: array item type change ─────────────────────────────────

  it('should detect BREAKING for array item type change', () => {
    const newData = { ...baseData, items: ['A+'] }; // object[] → string[]
    const newSnapshot = createSnapshot('BloodRequest', '2.0.0', newData);

    const result = diffSnapshots(baseSnapshot, newSnapshot);

    expect(result.hasBreakingChanges).toBe(true);
  });

  // ── Override mechanism ────────────────────────────────────────────────

  it('should pass when breaking change has an approved override', () => {
    const { amount: _removed, ...withoutAmount } = baseData;
    const newSnapshot = createSnapshot('BloodRequest', '2.0.0', withoutAmount);

    const overrides: BreakingChangeOverride[] = [
      {
        snapshotName: 'BloodRequest',
        path: 'BloodRequest.amount',
        approvedBy: 'maintainer@example.com',
        approvedAt: '2026-04-28T00:00:00Z',
        reason: 'amount field moved to nested billing object',
      },
    ];

    const result = diffSnapshots(baseSnapshot, newSnapshot, overrides);

    expect(result.hasBreakingChanges).toBe(true);
    expect(result.overrideApproved).toBe(true);
    expect(() => assertNoUnapprovedBreaks(result, 'BloodRequest')).not.toThrow();
  });

  it('should throw when breaking change has no override', () => {
    const { amount: _removed, ...withoutAmount } = baseData;
    const newSnapshot = createSnapshot('BloodRequest', '2.0.0', withoutAmount);

    const result = diffSnapshots(baseSnapshot, newSnapshot);

    expect(() => assertNoUnapprovedBreaks(result, 'BloodRequest')).toThrow(
      /Breaking schema changes detected/,
    );
  });

  it('should require override for correct snapshot name', () => {
    const { amount: _removed, ...withoutAmount } = baseData;
    const newSnapshot = createSnapshot('BloodRequest', '2.0.0', withoutAmount);

    // Override for a different snapshot — should NOT cover BloodRequest
    const overrides: BreakingChangeOverride[] = [
      {
        snapshotName: 'OtherSchema',
        path: 'BloodRequest.amount',
        approvedBy: 'maintainer@example.com',
        approvedAt: '2026-04-28T00:00:00Z',
        reason: 'wrong snapshot',
      },
    ];

    const result = diffSnapshots(baseSnapshot, newSnapshot, overrides);

    expect(result.overrideApproved).toBe(false);
  });

  // ── Migration notes ───────────────────────────────────────────────────

  it('should generate migration notes for breaking changes', () => {
    const { status: _removed, ...withoutStatus } = baseData;
    const newSnapshot = createSnapshot('BloodRequest', '2.0.0', withoutStatus);

    const result = diffSnapshots(baseSnapshot, newSnapshot);

    expect(result.migrationNotes.length).toBeGreaterThan(0);
    expect(result.migrationNotes.some((n) => n.includes('[BREAKING]'))).toBe(true);
    expect(result.migrationNotes.some((n) => n.includes('status'))).toBe(true);
  });

  it('should generate migration notes for additive changes', () => {
    const newData = { ...baseData, trackingId: 'TRK-001' };
    const newSnapshot = createSnapshot('BloodRequest', '1.1.0', newData);

    const result = diffSnapshots(baseSnapshot, newSnapshot);

    expect(result.migrationNotes.some((n) => n.includes('[ADDITIVE]'))).toBe(true);
  });

  // ── No changes ────────────────────────────────────────────────────────

  it('should return no changes for identical schemas', () => {
    const sameSnapshot = createSnapshot('BloodRequest', '1.0.0', baseData);

    const result = diffSnapshots(baseSnapshot, sameSnapshot);

    expect(result.hasBreakingChanges).toBe(false);
    expect(result.changes).toHaveLength(0);
    expect(result.overrideApproved).toBe(true);
  });
});
