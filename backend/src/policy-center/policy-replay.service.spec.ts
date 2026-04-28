import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { PolicyVersionEntity } from './entities/policy-version.entity';
import { PolicyVersionStatus } from './enums/policy-version-status.enum';
import { PolicyReplayService } from './policy-replay.service';
import { OperationalPolicyRules } from './policy-config.types';

const baseRules: OperationalPolicyRules = {
  anomaly: {
    duplicateEmergencyMinCount: 3,
    riderMinOrders: 5,
    riderCancellationRatioThreshold: 0.4,
    disputeCountThreshold: 3,
    stockSwingWindowMinutes: 60,
    stockSwingMinOrders: 10,
  },
  dispatch: { acceptanceTimeoutMs: 180000, distanceWeight: 0.5, workloadWeight: 0.3, ratingWeight: 0.2 },
  inventory: { expiringSoonHours: 72 },
  notification: {
    defaultQuietHoursEnabled: false,
    defaultQuietHoursStart: '22:00',
    defaultQuietHoursEnd: '06:00',
    defaultEmergencyBypassTier: 'normal',
  },
};

const makeEntity = (overrides: Partial<PolicyVersionEntity> = {}): PolicyVersionEntity =>
  ({
    id: 'v1',
    policyName: 'operational-core',
    version: 1,
    status: PolicyVersionStatus.ACTIVE,
    rules: baseRules,
    rulesHash: null,
    immutable: true,
    ...overrides,
  } as PolicyVersionEntity);

describe('PolicyReplayService (Issue #618)', () => {
  let service: PolicyReplayService;
  let findOne: jest.Mock;
  let save: jest.Mock;

  beforeEach(async () => {
    findOne = jest.fn();
    save = jest.fn().mockImplementation((e) => Promise.resolve(e));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PolicyReplayService,
        { provide: getRepositoryToken(PolicyVersionEntity), useValue: { findOne, save } },
      ],
    }).compile();

    service = module.get(PolicyReplayService);
  });

  it('computeRulesHash returns consistent hash', () => {
    const h1 = service.computeRulesHash(baseRules);
    const h2 = service.computeRulesHash(baseRules);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it('replay returns archived rules and empty drift when current matches', async () => {
    const entity = makeEntity({ rulesHash: service.computeRulesHash(baseRules) });
    findOne.mockResolvedValueOnce(entity).mockResolvedValueOnce(entity);
    const result = await service.replay('v1');
    expect(result.hasDrift).toBe(false);
    expect(result.driftReport).toHaveLength(0);
    expect(result.rulesHash).toHaveLength(64);
  });

  it('replay detects drift when current rules differ', async () => {
    const archived = makeEntity({ rulesHash: service.computeRulesHash(baseRules) });
    const currentRules = { ...baseRules, inventory: { expiringSoonHours: 48 } };
    const current = makeEntity({ rules: currentRules as OperationalPolicyRules });
    findOne.mockResolvedValueOnce(archived).mockResolvedValueOnce(current);
    const result = await service.replay('v1');
    expect(result.hasDrift).toBe(true);
    expect(result.driftReport.some((d) => d.path === 'inventory.expiringSoonHours')).toBe(true);
  });

  it('replay throws NotFoundException for unknown id', async () => {
    findOne.mockResolvedValue(null);
    await expect(service.replay('unknown')).rejects.toThrow(NotFoundException);
  });

  it('replay throws BadRequestException for non-immutable version', async () => {
    findOne.mockResolvedValue(makeEntity({ immutable: false }));
    await expect(service.replay('v1')).rejects.toThrow(BadRequestException);
  });

  it('assertMutable throws for immutable entity', () => {
    expect(() => service.assertMutable(makeEntity({ immutable: true }))).toThrow(BadRequestException);
  });

  it('assertMutable passes for mutable entity', () => {
    expect(() => service.assertMutable(makeEntity({ immutable: false }))).not.toThrow();
  });

  it('lockSnapshot sets rulesHash and immutable=true', async () => {
    const entity = makeEntity({ immutable: false, rulesHash: null });
    const result = await service.lockSnapshot(entity);
    expect(result.immutable).toBe(true);
    expect(result.rulesHash).toHaveLength(64);
  });
});
