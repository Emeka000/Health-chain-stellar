import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import { OrganizationEntity } from '../entities/organization.entity';
import { OrganizationType } from '../enums/organization-type.enum';
import { InventoryStockEntity } from '../../inventory/entities/inventory-stock.entity';
import { BloodRequestEntity } from '../../blood-requests/entities/blood-request.entity';
import { BloodRequestStatus } from '../../blood-requests/enums/blood-request-status.enum';
import { OrderEntity } from '../../orders/entities/order.entity';
import { OrderStatus } from '../../orders/enums/order-status.enum';
import { OrgStatsService } from './org-stats.service';

const ORG_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeQb(overrides: Record<string, jest.Mock> = {}) {
  const qb: Record<string, jest.Mock> = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
    ...overrides,
  };
  return qb;
}

function makeRepo(qbOverrides: Record<string, jest.Mock> = {}) {
  const qb = makeQb(qbOverrides);
  return {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    _qb: qb,
  };
}

describe('OrgStatsService', () => {
  let service: OrgStatsService;
  let orgRepo: ReturnType<typeof makeRepo>;
  let inventoryRepo: ReturnType<typeof makeRepo>;
  let bloodRequestRepo: ReturnType<typeof makeRepo>;
  let orderRepo: ReturnType<typeof makeRepo>;
  let dataSource: { query: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock };

  beforeEach(async () => {
    orgRepo = makeRepo();
    inventoryRepo = makeRepo();
    bloodRequestRepo = makeRepo();
    orderRepo = makeRepo();
    dataSource = { query: jest.fn().mockResolvedValue([{ avg_seconds: null }]) };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrgStatsService,
        { provide: getRepositoryToken(OrganizationEntity), useValue: orgRepo },
        { provide: getRepositoryToken(InventoryStockEntity), useValue: inventoryRepo },
        { provide: getRepositoryToken(BloodRequestEntity), useValue: bloodRequestRepo },
        { provide: getRepositoryToken(OrderEntity), useValue: orderRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    service = module.get(OrgStatsService);
  });

  describe('tenant isolation', () => {
    it('throws ForbiddenException when orgId !== requestingOrgId', async () => {
      await expect(
        service.getStats(ORG_ID, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('zero state', () => {
    it('returns all zeros for a brand-new organization with no data', async () => {
      // monthly trends query returns empty
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('avg_seconds')) return [{ avg_seconds: null }];
        return [];
      });

      const stats = await service.getStats(ORG_ID, ORG_ID);

      expect(stats.delivery_success_rate).toBe(0);
      expect(stats.avg_response_time).toBe(0);
      expect(stats.monthly_trends).toHaveLength(12);
      expect(stats.monthly_trends.every((v) => v === 0)).toBe(true);
      expect(stats.mom_delivery_success_rate_change).toBe(0);
      expect(stats.mom_avg_response_time_change).toBe(0);
      expect(stats.activity_timeline).toEqual([]);
    });

    it('returns 0 (not null/undefined) for all numeric fields', async () => {
      dataSource.query.mockResolvedValue([]);
      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.delivery_success_rate).not.toBeNull();
      expect(stats.avg_response_time).not.toBeNull();
    });
  });

  describe('avg_response_time ignores cancelled requests', () => {
    it('uses only DISPATCHED/CONFIRMED/DELIVERED statuses in SQL', async () => {
      dataSource.query.mockResolvedValue([{ avg_seconds: '120' }]);
      const stats = await service.getStats(ORG_ID, ORG_ID);

      const sqlCall = dataSource.query.mock.calls.find(
        (c: [string]) => c[0].includes('avg_seconds'),
      );
      expect(sqlCall).toBeDefined();
      const sql: string = sqlCall![0];
      expect(sql).toContain(OrderStatus.DISPATCHED);
      expect(sql).toContain(OrderStatus.CONFIRMED);
      expect(sql).toContain(OrderStatus.DELIVERED);
      expect(sql).not.toContain(OrderStatus.CANCELLED);
      expect(stats.avg_response_time).toBe(120);
    });
  });

  describe('blood bank metrics', () => {
    beforeEach(() => {
      orgRepo.findOne.mockResolvedValue({
        id: ORG_ID,
        type: OrganizationType.BLOOD_BANK,
      } as OrganizationEntity);

      // inventory total
      inventoryRepo._qb.getRawOne.mockResolvedValue({ total: '500' });
      // dispatched units
      orderRepo._qb.getRawOne
        .mockResolvedValueOnce({ total: '200' }) // dispatched
        .mockResolvedValueOnce({ total: '400' }); // collected
    });

    it('calculates total_blood_units and inventory_turnover', async () => {
      dataSource.query.mockResolvedValue([]);
      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.total_blood_units).toBe(500);
      expect(stats.inventory_turnover).toBe(0.5);
    });

    it('returns inventory_turnover = 0 when collected = 0', async () => {
      inventoryRepo._qb.getRawOne.mockReset().mockResolvedValue({ total: '0' });
      orderRepo._qb.getRawOne.mockReset().mockResolvedValue({ total: '0' });
      dataSource.query.mockResolvedValue([]);
      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.inventory_turnover).toBe(0);
    });
  });

  describe('hospital metrics', () => {
    beforeEach(() => {
      orgRepo.findOne.mockResolvedValue({
        id: ORG_ID,
        type: OrganizationType.HOSPITAL,
      } as OrganizationEntity);
    });

    it('calculates total_requests and request_fulfillment_rate', async () => {
      bloodRequestRepo.count
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8); // fulfilled
      dataSource.query.mockResolvedValue([]);

      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.total_requests).toBe(10);
      expect(stats.request_fulfillment_rate).toBe(80);
    });

    it('returns request_fulfillment_rate = 0 when no requests', async () => {
      bloodRequestRepo.count.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([]);
      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.request_fulfillment_rate).toBe(0);
    });
  });

  describe('delivery_success_rate', () => {
    it('calculates correctly from dispatched vs delivered counts', async () => {
      // getCount calls: [totalDispatches current, successfulDeliveries current,
      //                  totalDispatches prev, successfulDeliveries prev]
      orderRepo._qb.getCount
        .mockResolvedValueOnce(10) // current total dispatches
        .mockResolvedValueOnce(8) // current delivered
        .mockResolvedValueOnce(5) // prev total dispatches
        .mockResolvedValueOnce(3); // prev delivered
      dataSource.query.mockResolvedValue([{ avg_seconds: null }]);

      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.delivery_success_rate).toBe(80);
    });

    it('returns 0 when no dispatches', async () => {
      orderRepo._qb.getCount.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([]);
      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.delivery_success_rate).toBe(0);
    });
  });

  describe('monthly_trends', () => {
    it('always returns exactly 12 entries', async () => {
      dataSource.query.mockImplementation((sql: string) => {
        if (sql.includes('avg_seconds')) return [{ avg_seconds: null }];
        // Return only 3 months of data
        return [
          { month: '2025-01', count: '5' },
          { month: '2025-06', count: '10' },
          { month: '2025-12', count: '3' },
        ];
      });
      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.monthly_trends).toHaveLength(12);
    });
  });

  describe('MoM comparison', () => {
    it('calculates percent change correctly', async () => {
      // delivery: prev=50, current=75 → +50%
      orderRepo._qb.getCount
        .mockResolvedValueOnce(4) // current total
        .mockResolvedValueOnce(3) // current delivered → 75%
        .mockResolvedValueOnce(4) // prev total
        .mockResolvedValueOnce(2); // prev delivered → 50%
      dataSource.query.mockResolvedValue([{ avg_seconds: null }]);

      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.mom_delivery_success_rate_change).toBe(50);
    });

    it('returns 0 MoM change when both periods are zero', async () => {
      orderRepo._qb.getCount.mockResolvedValue(0);
      dataSource.query.mockResolvedValue([]);
      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.mom_delivery_success_rate_change).toBe(0);
    });
  });

  describe('Redis caching', () => {
    it('returns cached result without hitting DB on second call', async () => {
      const cached = JSON.stringify({
        organizationId: ORG_ID,
        delivery_success_rate: 99,
        avg_response_time: 0,
        monthly_trends: new Array(12).fill(0),
        mom_delivery_success_rate_change: 0,
        mom_avg_response_time_change: 0,
        activity_timeline: [],
      });
      redis.get.mockResolvedValue(cached);

      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.delivery_success_rate).toBe(99);
      expect(orgRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('activity_timeline', () => {
    it('returns at most 20 events sorted by timestamp desc', async () => {
      const now = new Date();
      const requests = Array.from({ length: 15 }, (_, i) => ({
        id: `req-${i}`,
        status: BloodRequestStatus.PENDING,
        updatedAt: new Date(now.getTime() - i * 1000),
      }));
      const orders = Array.from({ length: 15 }, (_, i) => ({
        id: `ord-${i}`,
        status: OrderStatus.DELIVERED,
        updatedAt: new Date(now.getTime() - i * 500),
      }));

      bloodRequestRepo._qb.getMany.mockResolvedValue(requests);
      orderRepo._qb.getMany.mockResolvedValue(orders);
      dataSource.query.mockResolvedValue([]);

      const stats = await service.getStats(ORG_ID, ORG_ID);
      expect(stats.activity_timeline.length).toBeLessThanOrEqual(20);
      // Verify descending order
      for (let i = 1; i < stats.activity_timeline.length; i++) {
        expect(
          new Date(stats.activity_timeline[i - 1].timestamp).getTime(),
        ).toBeGreaterThanOrEqual(
          new Date(stats.activity_timeline[i].timestamp).getTime(),
        );
      }
    });
  });
});
