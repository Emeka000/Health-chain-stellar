import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { HospitalEntity } from '../hospitals/entities/hospital.entity';
import { InventoryStockEntity } from '../inventory/entities/inventory-stock.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { RiderEntity } from '../riders/entities/rider.entity';

import { SurgeRuleEntity } from './entities/surge-rule.entity';
import {
  SurgeScenarioEntity,
  ScenarioStatus,
} from './entities/surge-scenario.entity';
import { SurgeSimulationService } from './surge-simulation.service';

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((v: unknown) => v),
  save: jest.fn((v: unknown) =>
    Promise.resolve({ id: 'sc-1', ...(v as object) }),
  ),
  update: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(5),
    getMany: jest.fn().mockResolvedValue([]),
    getRawMany: jest.fn().mockResolvedValue([]),
    getRawOne: jest.fn().mockResolvedValue({ total: '0' }),
  })),
  findAndCount: jest.fn().mockResolvedValue([[], 0]),
});

describe('SurgeSimulationService', () => {
  let service: SurgeSimulationService;
  let inventoryRepo: ReturnType<typeof mockRepo>;
  let riderRepo: ReturnType<typeof mockRepo>;
  let scenarioRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    inventoryRepo = mockRepo();
    riderRepo = mockRepo();
    scenarioRepo = mockRepo();

    const module = await Test.createTestingModule({
      providers: [
        SurgeSimulationService,
        {
          provide: getRepositoryToken(InventoryStockEntity),
          useValue: inventoryRepo,
        },
        { provide: getRepositoryToken(RiderEntity), useValue: riderRepo },
        { provide: getRepositoryToken(SurgeRuleEntity), useValue: mockRepo() },
        { provide: getRepositoryToken(HospitalEntity), useValue: mockRepo() },
        {
          provide: getRepositoryToken(SurgeScenarioEntity),
          useValue: scenarioRepo,
        },
        { provide: NotificationsService, useValue: { send: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();
    service = module.get(SurgeSimulationService);
  });

  describe('simulate', () => {
    it('returns canAbsorbWithStock=true when stock >= demand', async () => {
      const result = await service.simulate({
        surgeDemandUnits: 500,
        overrideStockUnits: 1000,
      });
      expect(result.canAbsorbWithStock).toBe(true);
      expect(result.stockGapUnits).toBe(0);
    });

    it('returns canAbsorbWithStock=false when stock < demand', async () => {
      const result = await service.simulate({
        surgeDemandUnits: 500,
        overrideStockUnits: 100,
      });
      expect(result.canAbsorbWithStock).toBe(false);
      expect(result.stockGapUnits).toBe(400);
    });

    it('uses override stock when provided', async () => {
      const result = await service.simulate({
        surgeDemandUnits: 200,
        overrideStockUnits: 300,
      });
      expect(result.baselineStockUnits).toBe(300);
      expect(result.canAbsorbWithStock).toBe(true);
    });

    it('computes shortageRiskScore between 0 and 1', async () => {
      const result = await service.simulate({
        surgeDemandUnits: 100,
        overrideStockUnits: 50,
      });
      expect(result.shortageRiskScore).toBeGreaterThan(0);
      expect(result.shortageRiskScore).toBeLessThanOrEqual(1);
    });

    it('produces deterministic results with same seed', async () => {
      const r1 = await service.simulate(
        { surgeDemandUnits: 100, overrideStockUnits: 50 },
        42,
      );
      const r2 = await service.simulate(
        { surgeDemandUnits: 100, overrideStockUnits: 50 },
        42,
      );
      expect(r1.estimatedFulfillmentLatencyMinutes).toBe(
        r2.estimatedFulfillmentLatencyMinutes,
      );
    });

    it('produces different results with different seeds', async () => {
      const r1 = await service.simulate(
        { surgeDemandUnits: 100, overrideStockUnits: 50 },
        1,
      );
      const r2 = await service.simulate(
        { surgeDemandUnits: 100, overrideStockUnits: 50 },
        999999,
      );
      expect(typeof r1.estimatedFulfillmentLatencyMinutes).toBe('number');
      expect(typeof r2.estimatedFulfillmentLatencyMinutes).toBe('number');
    });
  });

  describe('scenario management', () => {
    it('createScenario stores scenario with auto-generated seed', async () => {
      await service.createScenario(
        { name: 'Test', surgeDemandUnits: 200 },
        'user-1',
      );
      expect(scenarioRepo.save).toHaveBeenCalled();
    });

    it('replayScenario throws NotFoundException for unknown id', async () => {
      scenarioRepo.findOne.mockResolvedValue(null);
      await expect(service.replayScenario('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('replayScenario uses stored seed for deterministic result', async () => {
      inventoryRepo.find.mockResolvedValue([{ availableUnitsMl: 50 }]);
      scenarioRepo.findOne.mockResolvedValue({
        id: 'sc-1',
        surgeDemandUnits: 100,
        seed: 42,
        unitsPerRider: 4,
        overrideStockUnits: 50,
        overrideRiderCapacityUnits: null,
        status: ScenarioStatus.PENDING,
      });
      const result = await service.replayScenario('sc-1');
      expect(result.surgeDemandUnits).toBe(100);
      expect(scenarioRepo.update).toHaveBeenCalledWith(
        'sc-1',
        expect.objectContaining({ status: ScenarioStatus.COMPLETED }),
      );
    });

    it('compareScenarios identifies stock bottleneck', async () => {
      inventoryRepo.find.mockResolvedValue([{ availableUnitsMl: 50 }]);
      scenarioRepo.findOne
        .mockResolvedValueOnce({
          id: 'sc-1',
          name: 'A',
          surgeDemandUnits: 200,
          seed: 1,
          unitsPerRider: 4,
          overrideStockUnits: 50,
          overrideRiderCapacityUnits: 200,
          policyConfig: {},
        })
        .mockResolvedValueOnce({
          id: 'sc-2',
          name: 'B',
          surgeDemandUnits: 300,
          seed: 2,
          unitsPerRider: 4,
          overrideStockUnits: 50,
          overrideRiderCapacityUnits: 300,
          policyConfig: {},
        });

      const result = await service.compareScenarios(['sc-1', 'sc-2']);
      expect(result.bottleneck).toBe('stock');
      expect(result.scenarios).toHaveLength(2);
      expect(typeof result.recommendation).toBe('string');
    });
  });
});
