import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { ReputationEventType } from '../enums/reputation-event-type.enum';
import {
  AbuseFlag,
  ModerationStatus,
  ReputationAbuseFlagEntity,
} from '../entities/reputation-abuse-flag.entity';
import { FINALIZATION_DELAY_MS, ReputationAbuseService } from '../reputation-abuse.service';

function makeFlag(overrides: Partial<ReputationAbuseFlagEntity> = {}): ReputationAbuseFlagEntity {
  return {
    id: 'flag-1',
    riderId: 'rider-1',
    historyId: 'hist-1',
    flag: AbuseFlag.HIGH_IMPACT_UNVERIFIED,
    status: ModerationStatus.PENDING,
    evidence: null,
    withheldDelta: 25,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ReputationAbuseFlagEntity;
}

function makeService(flagRecord?: ReputationAbuseFlagEntity | null, historyCount = 0) {
  const flagRepo = {
    create: jest.fn((d) => ({ ...d })),
    save: jest.fn(async (r) => ({ ...r })),
    findOne: jest.fn(async () => flagRecord ?? null),
    find: jest.fn(async () => (flagRecord ? [flagRecord] : [])),
    count: jest.fn(async () => historyCount),
  };
  const historyRepo = {
    count: jest.fn(async () => historyCount),
    find: jest.fn(async () => []),
  };
  return {
    svc: new ReputationAbuseService(flagRepo as any, historyRepo as any),
    flagRepo,
    historyRepo,
  };
}

describe('ReputationAbuseService', () => {
  describe('checkRateLimit', () => {
    it('returns false when under the limit', async () => {
      const { svc } = makeService(null, 5);
      expect(await svc.checkRateLimit('rider-1', 'rep-1')).toBe(false);
    });

    it('returns true and raises a flag when limit is reached', async () => {
      const { svc, flagRepo } = makeService(null, 10);
      const result = await svc.checkRateLimit('rider-1', 'rep-1');
      expect(result).toBe(true);
      expect(flagRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ flag: AbuseFlag.RATE_LIMIT_EXCEEDED }),
      );
    });
  });

  describe('checkHighImpact', () => {
    it('returns false for delta at or below threshold', async () => {
      const { svc } = makeService();
      expect(await svc.checkHighImpact('rider-1', 20, null, false)).toBe(false);
    });

    it('returns false when admin-validated regardless of delta', async () => {
      const { svc } = makeService();
      expect(await svc.checkHighImpact('rider-1', 100, null, true)).toBe(false);
    });

    it('returns true and raises flag for high-impact unvalidated change', async () => {
      const { svc, flagRepo } = makeService();
      const result = await svc.checkHighImpact('rider-1', 50, 'hist-1', false);
      expect(result).toBe(true);
      expect(flagRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ flag: AbuseFlag.HIGH_IMPACT_UNVERIFIED, withheldDelta: 50 }),
      );
    });
  });

  describe('collusionWeight', () => {
    it('returns 1.0 when diversity is sufficient', async () => {
      const { svc, historyRepo } = makeService();
      historyRepo.find.mockResolvedValue([
        { referenceId: 'a' },
        { referenceId: 'b' },
        { referenceId: 'c' },
        { referenceId: 'd' },
      ]);
      expect(await svc.collusionWeight('rider-1', 'rep-1')).toBe(1.0);
    });

    it('returns 0.5 and raises flag when cluster is dense with low diversity', async () => {
      const { svc, historyRepo, flagRepo } = makeService();
      // 10 entries all from the same 2 counterparties
      historyRepo.find.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({ referenceId: i % 2 === 0 ? 'a' : 'b' })),
      );
      const weight = await svc.collusionWeight('rider-1', 'rep-1');
      expect(weight).toBe(0.5);
      expect(flagRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ flag: AbuseFlag.COLLUSION_CLUSTER }),
      );
    });
  });

  describe('sybilWeight', () => {
    it('returns 0.25 for brand-new account with few transactions', () => {
      const { svc } = makeService();
      expect(svc.sybilWeight(new Date(), 1)).toBe(0.25);
    });

    it('returns 0.6 for account < 30 days old', () => {
      const { svc } = makeService();
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
      expect(svc.sybilWeight(tenDaysAgo, 5)).toBe(0.6);
    });

    it('returns 1.0 for established account', () => {
      const { svc } = makeService();
      const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
      expect(svc.sybilWeight(ninetyOneDaysAgo, 30)).toBe(1.0);
    });
  });

  describe('moderation workflow', () => {
    it('listPendingFlags returns pending flags', async () => {
      const flag = makeFlag();
      const { svc } = makeService(flag);
      const result = await svc.listPendingFlags();
      expect(result).toHaveLength(1);
    });

    it('startReview sets status to UNDER_REVIEW', async () => {
      const { svc, flagRepo } = makeService(makeFlag());
      await svc.startReview('flag-1', 'admin-1');
      expect(flagRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ModerationStatus.UNDER_REVIEW, reviewedBy: 'admin-1' }),
      );
    });

    it('clearFlag sets status to CLEARED', async () => {
      const { svc, flagRepo } = makeService(makeFlag());
      await svc.clearFlag('flag-1', 'admin-1', 'looks fine');
      expect(flagRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ModerationStatus.CLEARED, reviewNote: 'looks fine' }),
      );
    });

    it('reverseFlag sets status to REVERSED', async () => {
      const { svc, flagRepo } = makeService(makeFlag());
      await svc.reverseFlag('flag-1', 'admin-1', 'confirmed abuse');
      expect(flagRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ModerationStatus.REVERSED }),
      );
    });

    it('clearFlag throws if flag is already REVERSED', async () => {
      const { svc } = makeService(makeFlag({ status: ModerationStatus.REVERSED }));
      await expect(svc.clearFlag('flag-1', 'admin-1', 'note')).rejects.toThrow(ForbiddenException);
    });

    it('reverseFlag throws if flag is already CLEARED', async () => {
      const { svc } = makeService(makeFlag({ status: ModerationStatus.CLEARED }));
      await expect(svc.reverseFlag('flag-1', 'admin-1', 'note')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for unknown flag id', async () => {
      const { svc } = makeService(null);
      await expect(svc.clearFlag('unknown', 'admin-1', 'note')).rejects.toThrow(NotFoundException);
    });
  });

  describe('isFinalized', () => {
    it('returns true when no flag exists', async () => {
      const { svc } = makeService(null);
      expect(await svc.isFinalized('hist-1')).toBe(true);
    });

    it('returns false when flag is PENDING', async () => {
      const { svc } = makeService(makeFlag({ status: ModerationStatus.PENDING }));
      expect(await svc.isFinalized('hist-1')).toBe(false);
    });

    it('returns false when flag is REVERSED', async () => {
      const { svc } = makeService(makeFlag({ status: ModerationStatus.REVERSED }));
      expect(await svc.isFinalized('hist-1')).toBe(false);
    });

    it('returns false when CLEARED but finalization delay not elapsed', async () => {
      const { svc } = makeService(
        makeFlag({ status: ModerationStatus.CLEARED, reviewedAt: new Date() }),
      );
      expect(await svc.isFinalized('hist-1')).toBe(false);
    });

    it('returns true when CLEARED and finalization delay has elapsed', async () => {
      const pastReview = new Date(Date.now() - FINALIZATION_DELAY_MS - 1000);
      const { svc } = makeService(
        makeFlag({ status: ModerationStatus.CLEARED, reviewedAt: pastReview }),
      );
      expect(await svc.isFinalized('hist-1')).toBe(true);
    });
  });

  describe('backtestFilters', () => {
    it('correctly counts high-impact entries', async () => {
      const { svc } = makeService();
      const entries = [
        { riderId: 'r1', reputationId: 'rep-1', delta: 5 },
        { riderId: 'r1', reputationId: 'rep-1', delta: 25 },
        { riderId: 'r1', reputationId: 'rep-1', delta: 30 },
      ];
      const result = await svc.backtestFilters(entries);
      expect(result.total).toBe(3);
      expect(result.flagged).toBe(2);
      expect(result.flagRate).toBeCloseTo(2 / 3);
    });

    it('returns zero flagRate for empty input', async () => {
      const { svc } = makeService();
      const result = await svc.backtestFilters([]);
      expect(result.flagRate).toBe(0);
    });
  });
});
