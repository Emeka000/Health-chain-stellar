import { TriageScoringService } from './triage-scoring.service';
import { RequestUrgency } from '../entities/blood-request.entity';
import { ItemPriority } from '../entities/blood-request-item.entity';

describe('TriageScoringService', () => {
  const service = new TriageScoringService();

  it('produces deterministic scoring for the same input', () => {
    const input = {
      urgency: RequestUrgency.URGENT,
      itemPriority: ItemPriority.HIGH,
      requestedUnits: 4,
      availableUnits: 6,
      requiredByTimestamp: 1_000_000,
      currentTimestamp: 985_600,
      emergencyOverride: false,
    };

    const first = service.compute(input);
    const second = service.compute(input);

    expect(first).toEqual(second);
  });

  it('elevates emergency overrides above weighted scoring', () => {
    const result = service.compute({
      urgency: RequestUrgency.ROUTINE,
      itemPriority: ItemPriority.NORMAL,
      requestedUnits: 1,
      availableUnits: 20,
      requiredByTimestamp: 1_000_000,
      currentTimestamp: 990_000,
      emergencyOverride: true,
    });

    expect(result.score).toBe(1000);
    expect(result.factors.emergencyOverride).toBe(true);
  });

  it('preserves historical policy snapshots when already stored', () => {
    const stable = service.ensureStableSnapshot(
      {
        triageScore: 412,
        triagePolicyVersion: '2025-12-01.v1',
        triageFactors: {
          policyVersion: '2025-12-01.v1',
          urgency: 80,
          criticality: 70,
          quantity: 40,
          time: 90,
          scarcity: 60,
          inventoryPressure: 55,
          emergencyOverride: false,
          raw: {
            requestedUnits: 4,
            availableUnits: 6,
            hoursUntilRequiredBy: 2,
            itemPriority: ItemPriority.HIGH,
            urgency: RequestUrgency.URGENT,
          },
        },
      },
      {
        urgency: RequestUrgency.CRITICAL,
        itemPriority: ItemPriority.CRITICAL,
        requestedUnits: 10,
        availableUnits: 0,
        requiredByTimestamp: 1_000_000,
        currentTimestamp: 999_000,
      },
    );

    expect(stable.score).toBe(412);
    expect(stable.policyVersion).toBe('2025-12-01.v1');
    expect(stable.factors.raw.requestedUnits).toBe(4);
  });
});
