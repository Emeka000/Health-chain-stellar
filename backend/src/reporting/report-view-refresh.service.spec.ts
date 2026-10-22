/**
 * ReportViewRefreshService — unit tests
 *
 * Validates:
 *  - Concurrent refresh is attempted first; blocking fallback on failure
 *  - Metadata is updated correctly after refresh
 *  - isViewFresh respects both isStale flag and staleAfterSeconds TTL
 *  - markStale sets isStale=true without triggering a refresh
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';

import { ReportViewMetadataEntity } from './entities/report-view-metadata.entity';
import { ReportViewRefreshService } from './report-view-refresh.service';

const makeMeta = (overrides: Partial<ReportViewMetadataEntity> = {}): ReportViewMetadataEntity =>
  Object.assign(new ReportViewMetadataEntity(), {
    viewName: 'mv_daily_order_summary',
    lastRefreshed: new Date(Date.now() - 10_000), // 10 seconds ago
    refreshDurationMs: 50,
    rowCount: 100,
    isStale: false,
    staleAfterSeconds: 300,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

describe('ReportViewRefreshService', () => {
  let service: ReportViewRefreshService;
  let metaRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    const meta = makeMeta();

    metaRepo = {
      findOne: jest.fn().mockResolvedValue(meta),
      find: jest.fn().mockResolvedValue([meta]),
      create: jest.fn().mockImplementation((v) => Object.assign(new ReportViewMetadataEntity(), v)),
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([{ count: '42' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportViewRefreshService,
        { provide: getRepositoryToken(ReportViewMetadataEntity), useValue: metaRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<ReportViewRefreshService>(ReportViewRefreshService);
  });

  describe('refreshView', () => {
    it('attempts CONCURRENTLY refresh first', async () => {
      await service.refreshView('mv_daily_order_summary');
      expect(dataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('CONCURRENTLY'),
      );
    });

    it('falls back to blocking refresh when CONCURRENTLY fails', async () => {
      dataSource.query
        .mockRejectedValueOnce(new Error('cannot refresh concurrently'))
        .mockResolvedValueOnce([{ count: '10' }]); // blocking refresh
      await service.refreshView('mv_daily_order_summary');
      expect(dataSource.query).toHaveBeenCalledTimes(3); // CONCURRENTLY + blocking + COUNT
    });

    it('updates metadata after refresh', async () => {
      await service.refreshView('mv_daily_order_summary');
      expect(metaRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          isStale: false,
          rowCount: 42,
        }),
      );
    });

    it('creates metadata record if none exists', async () => {
      metaRepo.findOne.mockResolvedValue(null);
      await service.refreshView('mv_daily_order_summary');
      expect(metaRepo.create).toHaveBeenCalled();
    });
  });

  describe('refreshAll', () => {
    it('refreshes all registered views', async () => {
      const spy = jest.spyOn(service, 'refreshView').mockResolvedValue(makeMeta());
      await service.refreshAll();
      // 4 views registered
      expect(spy).toHaveBeenCalledTimes(4);
    });
  });

  describe('isViewFresh', () => {
    it('returns true when view is not stale and within TTL', async () => {
      const result = await service.isViewFresh('mv_daily_order_summary');
      expect(result).toBe(true);
    });

    it('returns false when isStale=true', async () => {
      metaRepo.findOne.mockResolvedValue(makeMeta({ isStale: true }));
      const result = await service.isViewFresh('mv_daily_order_summary');
      expect(result).toBe(false);
    });

    it('returns false when age exceeds staleAfterSeconds', async () => {
      metaRepo.findOne.mockResolvedValue(
        makeMeta({
          lastRefreshed: new Date(Date.now() - 400_000), // 400 seconds ago
          staleAfterSeconds: 300,
          isStale: false,
        }),
      );
      const result = await service.isViewFresh('mv_daily_order_summary');
      expect(result).toBe(false);
    });

    it('returns false when no metadata record exists', async () => {
      metaRepo.findOne.mockResolvedValue(null);
      const result = await service.isViewFresh('mv_daily_order_summary');
      expect(result).toBe(false);
    });
  });

  describe('markStale', () => {
    it('sets isStale=true without refreshing', async () => {
      await service.markStale('mv_daily_order_summary');
      expect(metaRepo.update).toHaveBeenCalledWith(
        { viewName: 'mv_daily_order_summary' },
        { isStale: true },
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });
  });

  describe('getFreshnessInfo', () => {
    it('returns freshness info with computed ageSeconds', async () => {
      const info = await service.getFreshnessInfo();
      expect(info).toHaveLength(1);
      expect(info[0].ageSeconds).toBeGreaterThanOrEqual(0);
      expect(info[0].viewName).toBe('mv_daily_order_summary');
    });

    it('marks as stale when age exceeds TTL even if isStale=false', async () => {
      metaRepo.find.mockResolvedValue([
        makeMeta({
          lastRefreshed: new Date(Date.now() - 400_000),
          staleAfterSeconds: 300,
          isStale: false,
        }),
      ]);
      const info = await service.getFreshnessInfo();
      expect(info[0].isStale).toBe(true);
    });
  });
});
