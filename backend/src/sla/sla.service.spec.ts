import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { SlaService } from './sla.service';
import { SlaRecordEntity } from './entities/sla-record.entity';
import { SlaStage } from './enums/sla-stage.enum';

/** Minimal mock repository factory */
function makeMockRepo(records: SlaRecordEntity[] = []) {
  const store = [...records];
  return {
    create: jest.fn((data: Partial<SlaRecordEntity>) => ({ ...data } as SlaRecordEntity)),
    save: jest.fn(async (entity: SlaRecordEntity) => {
      const idx = store.findIndex(
        (r) => r.orderId === entity.orderId && r.stage === entity.stage,
      );
      if (idx >= 0) store[idx] = entity;
      else store.push(entity);
      return entity;
    }),
    findOne: jest.fn(async ({ where }: { where: { orderId: string; stage: SlaStage } }) =>
      store.find((r) => r.orderId === where.orderId && r.stage === where.stage) ?? null,
    ),
    find: jest.fn(async ({ where }: { where: { orderId: string } }) =>
      store.filter((r) => r.orderId === where.orderId),
    ),
    createQueryBuilder: jest.fn(),
  };
}

describe('SlaService', () => {
  let service: SlaService;
  let repo: ReturnType<typeof makeMockRepo>;

  async function buildModule(initial: SlaRecordEntity[] = []) {
    repo = makeMockRepo(initial);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaService,
        { provide: getRepositoryToken(SlaRecordEntity), useValue: repo },
      ],
    }).compile();
    service = module.get(SlaService);
  }

  beforeEach(() => buildModule());

  // ── startStage ───────────────────────────────────────────────────────────────

  describe('startStage()', () => {
    it('creates a record with the correct budget for CRITICAL TRIAGE (300 s)', async () => {
      const record = await service.startStage('order-1', SlaStage.TRIAGE, {
        hospitalId: 'hosp-1',
        urgencyTier: 'CRITICAL',
      });
      expect(record.budgetSeconds).toBe(5 * 60);
      expect(record.urgencyTier).toBe('CRITICAL');
      expect(record.stage).toBe(SlaStage.TRIAGE);
      expect(record.breached).toBe(false);
      expect(record.pausedSeconds).toBe(0);
    });

    it('creates a record with the correct budget for URGENT TRIAGE (600 s)', async () => {
      const record = await service.startStage('order-2', SlaStage.TRIAGE, {
        hospitalId: 'hosp-1',
        urgencyTier: 'URGENT',
      });
      expect(record.budgetSeconds).toBe(10 * 60);
    });

    it('creates a record with the correct budget for STANDARD TRIAGE (1800 s)', async () => {
      const record = await service.startStage('order-3', SlaStage.TRIAGE, {
        hospitalId: 'hosp-1',
        urgencyTier: 'STANDARD',
      });
      expect(record.budgetSeconds).toBe(30 * 60);
    });

    it('defaults to STANDARD tier when urgencyTier is omitted', async () => {
      const record = await service.startStage('order-4', SlaStage.TRIAGE, {
        hospitalId: 'hosp-1',
      });
      expect(record.budgetSeconds).toBe(30 * 60);
      expect(record.urgencyTier).toBe('STANDARD');
    });

    it('stores hospitalId, bloodBankId, and riderId on the record', async () => {
      const record = await service.startStage('order-5', SlaStage.DISPATCH_ACCEPTANCE, {
        hospitalId: 'hosp-1',
        bloodBankId: 'bb-1',
        riderId: 'rider-1',
      });
      expect(record.hospitalId).toBe('hosp-1');
      expect(record.bloodBankId).toBe('bb-1');
      expect(record.riderId).toBe('rider-1');
    });
  });

  // ── pauseStage / resumeStage ─────────────────────────────────────────────────

  describe('pauseStage() / resumeStage()', () => {
    const ORDER = 'order-pause';

    beforeEach(async () => {
      await buildModule();
      await service.startStage(ORDER, SlaStage.TRIAGE, { hospitalId: 'h1' });
    });

    it('pauseStage adds a pause interval with null resumedAt', async () => {
      const record = await service.pauseStage(ORDER, SlaStage.TRIAGE);
      expect(record.pauseIntervals).toHaveLength(1);
      expect(record.pauseIntervals[0].pausedAt).toBeTruthy();
      expect(record.pauseIntervals[0].resumedAt).toBeNull();
    });

    it('resumeStage fills resumedAt and accumulates pausedSeconds', async () => {
      // Pause, wait a tick, resume
      await service.pauseStage(ORDER, SlaStage.TRIAGE);

      // Advance time by ~100 ms via fake Date
      const pausedAt = new Date(Date.now() - 2000); // 2 s ago
      const record = (await repo.findOne({ where: { orderId: ORDER, stage: SlaStage.TRIAGE } }))!;
      record.pauseIntervals[0].pausedAt = pausedAt.toISOString();
      await repo.save(record);

      const resumed = await service.resumeStage(ORDER, SlaStage.TRIAGE);
      expect(resumed.pauseIntervals[0].resumedAt).toBeTruthy();
      expect(resumed.pausedSeconds).toBeGreaterThanOrEqual(1);
    });

    it('multiple pause/resume cycles accumulate pausedSeconds correctly', async () => {
      // First pause/resume: 1 s
      await service.pauseStage(ORDER, SlaStage.TRIAGE);
      let r = (await repo.findOne({ where: { orderId: ORDER, stage: SlaStage.TRIAGE } }))!;
      r.pauseIntervals[0].pausedAt = new Date(Date.now() - 1000).toISOString();
      await repo.save(r);
      await service.resumeStage(ORDER, SlaStage.TRIAGE);

      // Second pause/resume: 2 s
      await service.pauseStage(ORDER, SlaStage.TRIAGE);
      r = (await repo.findOne({ where: { orderId: ORDER, stage: SlaStage.TRIAGE } }))!;
      r.pauseIntervals[1].pausedAt = new Date(Date.now() - 2000).toISOString();
      await repo.save(r);
      const final = await service.resumeStage(ORDER, SlaStage.TRIAGE);

      expect(final.pausedSeconds).toBeGreaterThanOrEqual(3);
    });
  });

  // ── completeStage ────────────────────────────────────────────────────────────

  describe('completeStage()', () => {
    const ORDER = 'order-complete';

    it('calculates elapsedSeconds subtracting pausedSeconds', async () => {
      await buildModule();
      await service.startStage(ORDER, SlaStage.TRIAGE, {
        hospitalId: 'h1',
        urgencyTier: 'STANDARD',
      });

      // Simulate 60 s elapsed with 10 s paused
      const r = (await repo.findOne({ where: { orderId: ORDER, stage: SlaStage.TRIAGE } }))!;
      r.startedAt = new Date(Date.now() - 60_000);
      r.pausedSeconds = 10;
      await repo.save(r);

      const completed = await service.completeStage(ORDER, SlaStage.TRIAGE);
      expect(completed.elapsedSeconds).toBeGreaterThanOrEqual(49);
      expect(completed.elapsedSeconds).toBeLessThanOrEqual(51);
      expect(completed.completedAt).toBeInstanceOf(Date);
    });

    it('sets breached=false when elapsed <= budget', async () => {
      await buildModule();
      await service.startStage(ORDER, SlaStage.TRIAGE, {
        hospitalId: 'h1',
        urgencyTier: 'STANDARD', // budget = 1800 s
      });

      const r = (await repo.findOne({ where: { orderId: ORDER, stage: SlaStage.TRIAGE } }))!;
      r.startedAt = new Date(Date.now() - 60_000); // only 60 s elapsed
      await repo.save(r);

      const completed = await service.completeStage(ORDER, SlaStage.TRIAGE);
      expect(completed.breached).toBe(false);
    });

    it('sets breached=true when elapsed > budget', async () => {
      await buildModule();
      await service.startStage(ORDER, SlaStage.TRIAGE, {
        hospitalId: 'h1',
        urgencyTier: 'CRITICAL', // budget = 300 s
      });

      const r = (await repo.findOne({ where: { orderId: ORDER, stage: SlaStage.TRIAGE } }))!;
      r.startedAt = new Date(Date.now() - 400_000); // 400 s elapsed > 300 s budget
      await repo.save(r);

      const completed = await service.completeStage(ORDER, SlaStage.TRIAGE);
      expect(completed.breached).toBe(true);
    });
  });

  // ── queryBreaches ────────────────────────────────────────────────────────────

  describe('queryBreaches()', () => {
    it('delegates to the repository query builder with breached=true filter', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      repo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.queryBreaches({});
      expect(mockQb.where).toHaveBeenCalledWith('sla.breached = true');
      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('applies hospitalId filter when provided', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      repo.createQueryBuilder.mockReturnValue(mockQb);

      await service.queryBreaches({ hospitalId: 'hosp-99' });
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'sla.hospitalId = :hospitalId',
        { hospitalId: 'hosp-99' },
      );
    });

    it('applies stage filter when provided', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      repo.createQueryBuilder.mockReturnValue(mockQb);

      await service.queryBreaches({ stage: SlaStage.TRIAGE });
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'sla.stage = :stage',
        { stage: SlaStage.TRIAGE },
      );
    });

    it('applies startDate and endDate filters when provided', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      repo.createQueryBuilder.mockReturnValue(mockQb);

      await service.queryBreaches({
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      });
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'sla.startedAt >= :startDate',
        { startDate: '2026-01-01' },
      );
      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'sla.startedAt <= :endDate',
        { endDate: '2026-12-31' },
      );
    });

    it('returns correct pagination metadata', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([new Array(5).fill({}), 50]),
      };
      repo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.queryBreaches({ page: 2, pageSize: 5 });
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(5);
      expect(result.total).toBe(50);
      expect(result.totalPages).toBe(10);
    });
  });

  // ── findRecord error path ────────────────────────────────────────────────────

  describe('findRecord() error path', () => {
    it('throws NotFoundException when record does not exist', async () => {
      await expect(
        service.completeStage('nonexistent', SlaStage.TRIAGE),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
