import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BloodUnit } from '../blood-units/entities/blood-unit.entity';

import { InventoryStockEntity } from './entities/inventory-stock.entity';
import { InventoryAnalyticsService } from './inventory-analytics.service';

const mockStockRepo = () => ({
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const mockBloodUnitRepo = () => ({
  find: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

function makeQb(rawResult: unknown[] = [], countResult = 0) {
  const qb: Record<string, jest.Mock> = {};
  const chain = () => qb;
  qb.select = jest.fn(chain);
  qb.addSelect = jest.fn(chain);
  qb.where = jest.fn(chain);
  qb.andWhere = jest.fn(chain);
  qb.groupBy = jest.fn(chain);
  qb.orderBy = jest.fn(chain);
  qb.having = jest.fn(chain);
  qb.getRawMany = jest.fn().mockResolvedValue(rawResult);
  qb.getRawOne = jest.fn().mockResolvedValue(rawResult[0] ?? {});
  qb.getCount = jest.fn().mockResolvedValue(countResult);
  return qb;
}

describe('InventoryAnalyticsService', () => {
  let service: InventoryAnalyticsService;
  let stockRepo: ReturnType<typeof mockStockRepo>;
  let bloodUnitRepo: ReturnType<typeof mockBloodUnitRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryAnalyticsService,
        {
          provide: getRepositoryToken(InventoryStockEntity),
          useFactory: mockStockRepo,
        },
        {
          provide: getRepositoryToken(BloodUnit),
          useFactory: mockBloodUnitRepo,
        },
      ],
    }).compile();

    service = module.get(InventoryAnalyticsService);
    stockRepo = module.get(getRepositoryToken(InventoryStockEntity));
    bloodUnitRepo = module.get(getRepositoryToken(BloodUnit));
  });

  describe('getSnapshot', () => {
    it('aggregates stock by blood type', async () => {
      const stock = Object.assign(new InventoryStockEntity(), {
        bloodType: 'A+',
        availableUnitsMl: 500,
        reservedUnitsMl: 100,
        allocatedUnitsMl: 50,
      });
      stockRepo.find.mockResolvedValue([stock]);

      const result = await service.getSnapshot();

      expect(result.totalAvailableMl).toBe(500);
      expect(result.totalReservedMl).toBe(100);
      expect(result.totalAllocatedMl).toBe(50);
      expect(result.byBloodType['A+']).toEqual({
        availableMl: 500,
        reservedMl: 100,
        allocatedMl: 50,
      });
    });

    it('returns zeros when no stock', async () => {
      stockRepo.find.mockResolvedValue([]);
      const result = await service.getSnapshot();
      expect(result.totalAvailableMl).toBe(0);
    });
  });

  describe('getTurnoverRates', () => {
    it('calculates turnover rate correctly', async () => {
      const consumedQb = makeQb([{ bloodType: 'O+', count: '10' }]);
      const stockQb = makeQb([{ bloodType: 'O+', avgMl: '200' }]);
      bloodUnitRepo.createQueryBuilder
        .mockReturnValueOnce(consumedQb)
        .mockReturnValueOnce(stockQb);
      stockRepo.createQueryBuilder.mockReturnValue(stockQb);

      // patch: service calls bloodUnitRepo twice and stockRepo once
      bloodUnitRepo.createQueryBuilder.mockReturnValueOnce(consumedQb);
      stockRepo.createQueryBuilder.mockReturnValue(stockQb);

      const result = await service.getTurnoverRates(30);
      expect(result[0].bloodType).toBe('O+');
      expect(result[0].unitsConsumed).toBe(10);
    });
  });

  describe('getWastageTracking', () => {
    it('computes wastage rate', async () => {
      const qb = makeQb([
        { bloodType: 'B+', expired: '5', disposed: '2', delivered: '13' },
      ]);
      bloodUnitRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getWastageTracking(30);
      expect(result[0].totalWastedUnits).toBe(7);
      expect(result[0].wastageRatePct).toBeCloseTo(35, 0);
    });
  });

  describe('getExpirationAnalytics', () => {
    it('returns expiration counts', async () => {
      bloodUnitRepo.count
        .mockResolvedValueOnce(2) // within24h
        .mockResolvedValueOnce(5) // within48h
        .mockResolvedValueOnce(8) // within72h
        .mockResolvedValueOnce(3); // alreadyExpired
      bloodUnitRepo.find.mockResolvedValue([
        { volumeMl: 450 },
        { volumeMl: 300 },
      ]);

      const result = await service.getExpirationAnalytics();
      expect(result.expiringWithin24h).toBe(2);
      expect(result.expiringWithin72h).toBe(8);
      expect(result.alreadyExpiredUnits).toBe(3);
      expect(result.totalAtRiskMl).toBe(750);
    });
  });

  describe('getTypeDistribution', () => {
    it('calculates share percentages', async () => {
      const qb = makeQb([
        { bloodType: 'O+', totalMl: '600' },
        { bloodType: 'A+', totalMl: '400' },
      ]);
      stockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getTypeDistribution();
      expect(result[0].sharePct).toBeCloseTo(60, 0);
      expect(result[1].sharePct).toBeCloseTo(40, 0);
    });
  });

  describe('getShortagePredictions', () => {
    it('flags blood types at risk', async () => {
      const consumedQb = makeQb([{ bloodType: 'AB-', totalMl: '700' }]);
      const stockQb = makeQb([{ bloodType: 'AB-', availableMl: '50' }]);
      bloodUnitRepo.createQueryBuilder.mockReturnValue(consumedQb);
      stockRepo.createQueryBuilder.mockReturnValue(stockQb);

      const result = await service.getShortagePredictions(7);
      expect(result[0].isAtRisk).toBe(true);
    });
  });

  describe('getTrendAnalysis', () => {
    it('returns trend points', async () => {
      stockRepo.find.mockResolvedValue([]);
      const consumedQb = makeQb([{ date: '2026-03-28', totalMl: '1200' }]);
      bloodUnitRepo.createQueryBuilder.mockReturnValue(consumedQb);

      const result = await service.getTrendAnalysis(14);
      expect(result[0].date).toBe('2026-03-28');
      expect(result[0].totalConsumedMl).toBe(1200);
    });
  });
});
