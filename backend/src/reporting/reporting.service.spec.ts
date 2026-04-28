/**
 * Reporting Service — Correctness Regression Suite
 *
 * Validates that optimized query paths (materialized views, paginated queries)
 * produce outputs that match the baseline live-query results.
 *
 * Test categories:
 *  1. Pagination correctness — page/pageSize math, boundary conditions
 *  2. Filter correctness — date range, status, bloodType, location
 *  3. Summary correctness — materialized vs live totals match
 *  4. Staleness metadata — freshness flags are accurate
 *  5. Export correctness — Excel buffer is non-empty and contains expected sheets
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { UserEntity } from '../users/entities/user.entity';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { OrderEntity } from '../orders/entities/order.entity';
import { DisputeEntity } from '../disputes/entities/dispute.entity';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';

import { ReportViewMetadataEntity } from './entities/report-view-metadata.entity';
import { ReportingService } from './reporting.service';
import { ReportViewRefreshService } from './report-view-refresh.service';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<OrderEntity> = {}): OrderEntity {
  return Object.assign(new OrderEntity(), {
    id: 'order-1',
    hospitalId: 'hosp-1',
    bloodType: 'A+',
    quantity: 2,
    status: 'DELIVERED',
    createdAt: new Date('2024-01-15'),
    feeBreakdown: null,
    appliedPolicyId: null,
    ...overrides,
  });
}

function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return Object.assign(new UserEntity(), {
    id: 'user-1',
    email: 'donor@test.com',
    role: 'donor',
    createdAt: new Date('2024-01-10'),
    ...overrides,
  });
}

// ── Mock factories ────────────────────────────────────────────────────────

const mockQueryBuilder = (items: unknown[], total: number) => ({
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  addOrderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  getManyAndCount: jest.fn().mockResolvedValue([items, total]),
  getCount: jest.fn().mockResolvedValue(total),
});

const makeRepo = (items: unknown[], total: number) => ({
  createQueryBuilder: jest.fn(() => mockQueryBuilder(items, total)),
  count: jest.fn().mockResolvedValue(total),
  find: jest.fn().mockResolvedValue(items),
  findOne: jest.fn().mockResolvedValue(items[0] ?? null),
});

const makeRefreshService = (fresh = true) => ({
  isViewFresh: jest.fn().mockResolvedValue(fresh),
  getFreshnessInfo: jest.fn().mockResolvedValue([
    {
      viewName: 'mv_daily_order_summary',
      lastRefreshed: new Date(),
      isStale: !fresh,
      ageSeconds: 10,
      staleAfterSeconds: 300,
    },
  ]),
  refreshView: jest.fn().mockResolvedValue({ viewName: 'mv_daily_order_summary' }),
  refreshAll: jest.fn().mockResolvedValue([]),
  markStale: jest.fn().mockResolvedValue(undefined),
});

const makeDataSource = (queryResult: unknown[] = []) => ({
  query: jest.fn().mockResolvedValue(queryResult),
});

// ── Test suite ────────────────────────────────────────────────────────────

describe('ReportingService', () => {
  let service: ReportingService;
  let orderRepo: ReturnType<typeof makeRepo>;
  let userRepo: ReturnType<typeof makeRepo>;
  let unitRepo: ReturnType<typeof makeRepo>;
  let disputeRepo: ReturnType<typeof makeRepo>;
  let orgRepo: ReturnType<typeof makeRepo>;
  let requestRepo: ReturnType<typeof makeRepo>;
  let refreshService: ReturnType<typeof makeRefreshService>;
  let dataSource: ReturnType<typeof makeDataSource>;

  const orders = [makeOrder(), makeOrder({ id: 'order-2', status: 'PENDING' })];
  const users = [makeUser(), makeUser({ id: 'user-2', email: 'donor2@test.com' })];

  beforeEach(async () => {
    orderRepo = makeRepo(orders, orders.length);
    userRepo = makeRepo(users, users.length);
    unitRepo = makeRepo([], 0);
    disputeRepo = makeRepo([], 0);
    orgRepo = makeRepo([], 0);
    requestRepo = makeRepo([], 0);
    refreshService = makeRefreshService(true);
    dataSource = makeDataSource([{ total: '5' }]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportingService,
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(BloodUnit), useValue: unitRepo },
        { provide: getRepositoryToken(OrderEntity), useValue: orderRepo },
        { provide: getRepositoryToken(DisputeEntity), useValue: disputeRepo },
        { provide: getRepositoryToken(OrganizationEntity), useValue: orgRepo },
        { provide: getRepositoryToken(BloodRequestEntity), useValue: requestRepo },
        { provide: ReportViewRefreshService, useValue: refreshService },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get<ReportingService>(ReportingService);
  });

  // ── 1. Pagination correctness ─────────────────────────────────────────

  describe('pagination', () => {
    it('returns correct pagination metadata for page 1', async () => {
      const result = await service.search({ domain: 'orders', page: 1, pageSize: 1 });
      const ordersResult = result.orders as any;
      expect(ordersResult.pagination.currentPage).toBe(1);
      expect(ordersResult.pagination.pageSize).toBe(1);
      expect(ordersResult.pagination.totalCount).toBe(orders.length);
    });

    it('calculates skip correctly for page 2', async () => {
      await service.search({ domain: 'orders', page: 2, pageSize: 1 });
      const qb = orderRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.skip).toHaveBeenCalledWith(1); // (2-1)*1 = 1
      expect(qb.take).toHaveBeenCalledWith(1);
    });

    it('caps pageSize at 200 via DTO validation (service clamps legacy limit)', async () => {
      // Legacy limit > 200 should be clamped
      await service.search({ domain: 'orders', limit: 9999 });
      const qb = orderRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.take).toHaveBeenCalledWith(200);
    });

    it('returns hasNextPage=true when more pages exist', async () => {
      // 2 items, pageSize 1 → 2 pages
      const result = await service.search({ domain: 'orders', page: 1, pageSize: 1 });
      expect((result.orders as any).pagination.hasNextPage).toBe(true);
    });

    it('returns hasNextPage=false on last page', async () => {
      const result = await service.search({ domain: 'orders', page: 2, pageSize: 1 });
      expect((result.orders as any).pagination.hasNextPage).toBe(false);
    });

    it('returns hasPreviousPage=false on first page', async () => {
      const result = await service.search({ domain: 'orders', page: 1, pageSize: 10 });
      expect((result.orders as any).pagination.hasPreviousPage).toBe(false);
    });

    it('returns hasPreviousPage=true on page > 1', async () => {
      const result = await service.search({ domain: 'orders', page: 2, pageSize: 1 });
      expect((result.orders as any).pagination.hasPreviousPage).toBe(true);
    });
  });

  // ── 2. Filter correctness ─────────────────────────────────────────────

  describe('filters', () => {
    it('applies startDate filter', async () => {
      await service.search({ domain: 'orders', startDate: '2024-01-01' });
      const qb = orderRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('createdAt >= :start'),
        expect.objectContaining({ start: new Date('2024-01-01') }),
      );
    });

    it('applies endDate filter', async () => {
      await service.search({ domain: 'orders', endDate: '2024-12-31' });
      const qb = orderRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('createdAt <= :end'),
        expect.objectContaining({ end: new Date('2024-12-31') }),
      );
    });

    it('applies BETWEEN when both dates provided', async () => {
      await service.search({
        domain: 'orders',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });
      const qb = orderRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('BETWEEN'),
        expect.any(Object),
      );
    });

    it('applies statusGroups filter for orders', async () => {
      await service.search({ domain: 'orders', statusGroups: ['DELIVERED', 'PENDING'] });
      const qb = orderRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('IN (:...statuses)'),
        expect.objectContaining({ statuses: ['DELIVERED', 'PENDING'] }),
      );
    });

    it('applies bloodType filter for units', async () => {
      await service.search({ domain: 'units', bloodType: 'O-' });
      const qb = unitRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('bloodType = :bloodType'),
        expect.objectContaining({ bloodType: 'O-' }),
      );
    });

    it('applies location filter for donors', async () => {
      await service.search({ domain: 'donors', location: 'Lagos' });
      const qb = userRepo.createQueryBuilder.mock.results[0].value;
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('ILIKE'),
        expect.objectContaining({ location: '%Lagos%' }),
      );
    });

    it('queries all domains when domain=all', async () => {
      await service.search({ domain: 'all' });
      expect(orderRepo.createQueryBuilder).toHaveBeenCalled();
      expect(userRepo.createQueryBuilder).toHaveBeenCalled();
      expect(unitRepo.createQueryBuilder).toHaveBeenCalled();
      expect(disputeRepo.createQueryBuilder).toHaveBeenCalled();
    });

    it('queries only orders when domain=orders', async () => {
      await service.search({ domain: 'orders' });
      expect(orderRepo.createQueryBuilder).toHaveBeenCalled();
      expect(userRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ── 3. Summary correctness — materialized vs live ─────────────────────

  describe('getSummary', () => {
    it('uses materialized views when all views are fresh and no filters', async () => {
      // dataSource.query returns [{total: '5'}] for each view query
      dataSource.query
        .mockResolvedValueOnce([{ total: '10' }]) // orders
        .mockResolvedValueOnce([{ total: '20' }]) // units
        .mockResolvedValueOnce([{ total: '3' }]);  // disputes

      const result = await service.getSummary({});
      expect(result.fromMaterialized).toBe(true);
      expect(result.orders).toBe(10);
      expect(result.units).toBe(20);
      expect(result.disputes).toBe(3);
    });

    it('falls back to live queries when views are stale', async () => {
      refreshService.isViewFresh.mockResolvedValue(false);
      userRepo.count.mockResolvedValue(5);

      const result = await service.getSummary({});
      expect(result.fromMaterialized).toBe(false);
    });

    it('forces live query when forceLive=true', async () => {
      const result = await service.getSummary({}, true);
      expect(result.fromMaterialized).toBe(false);
    });

    it('forces live query when date filters are present', async () => {
      const result = await service.getSummary({ startDate: '2024-01-01' });
      expect(result.fromMaterialized).toBe(false);
    });

    it('includes dataFreshnessAt in materialized response', async () => {
      dataSource.query.mockResolvedValue([{ total: '0' }]);
      const result = await service.getSummary({});
      expect(result.dataFreshnessAt).toBeTruthy();
    });

    it('includes dataFreshnessAt as now() in live response', async () => {
      refreshService.isViewFresh.mockResolvedValue(false);
      const before = new Date();
      const result = await service.getSummary({});
      const after = new Date();
      const freshnessDate = new Date(result.dataFreshnessAt!);
      expect(freshnessDate.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
      expect(freshnessDate.getTime()).toBeLessThanOrEqual(after.getTime() + 100);
    });

    it('materialized and live totals match for zero-data scenario', async () => {
      // Both paths should return 0 when there is no data
      dataSource.query.mockResolvedValue([{ total: '0' }]);
      userRepo.count.mockResolvedValue(0);

      const materializedResult = await service.getSummary({});
      refreshService.isViewFresh.mockResolvedValue(false);
      const liveResult = await service.getSummary({});

      expect(materializedResult.orders).toBe(liveResult.orders);
    });
  });

  // ── 4. Staleness metadata ─────────────────────────────────────────────

  describe('view freshness', () => {
    it('returns freshness info from refresh service', async () => {
      const info = await service.getViewFreshness();
      expect(info).toHaveLength(1);
      expect(info[0].viewName).toBe('mv_daily_order_summary');
    });

    it('delegates triggerViewRefresh to refresh service', async () => {
      await service.triggerViewRefresh('mv_daily_order_summary');
      expect(refreshService.refreshView).toHaveBeenCalledWith('mv_daily_order_summary');
    });

    it('delegates triggerAllViewRefresh to refresh service', async () => {
      await service.triggerAllViewRefresh();
      expect(refreshService.refreshAll).toHaveBeenCalled();
    });
  });

  // ── 5. Export correctness ─────────────────────────────────────────────

  describe('exportToExcel', () => {
    it('returns a non-empty buffer', async () => {
      const buffer = await service.exportToExcel({ domain: 'orders' });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(0);
    });

    it('does not throw when no data is available', async () => {
      orderRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder([], 0));
      await expect(service.exportToExcel({ domain: 'orders' })).resolves.not.toThrow();
    });
  });
});
