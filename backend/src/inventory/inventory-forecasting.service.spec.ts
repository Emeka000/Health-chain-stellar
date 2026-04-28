import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository, MoreThanOrEqual } from 'typeorm';

import { BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';
import { DonationEntity } from '../donations/entities/donation.entity';
import { InventoryLowEvent } from '../events/inventory-low.event';
import { OrderEntity } from '../orders/entities/order.entity';

import { InventoryEntity } from './entities/inventory.entity';
import { InventoryForecastingService } from './inventory-forecasting.service';

describe('InventoryForecastingService', () => {
  let service: InventoryForecastingService;
  let orderRepo: Repository<OrderEntity>;
  let requestRepo: Repository<BloodRequestEntity>;
  let donationRepo: Repository<DonationEntity>;
  let inventoryRepo: Repository<InventoryEntity>;
  let eventEmitter: EventEmitter2;
  let outreachQueue: any;

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: any) => {
      const config = {
        INVENTORY_FORECAST_THRESHOLD_DAYS: 3,
        INVENTORY_FORECAST_HISTORY_DAYS: 30,
        INVENTORY_FORECAST_DEFAULT_SEASON_LENGTH: 7,
      };
      return config[key] || defaultValue;
    }),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockQueue = {
    add: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryForecastingService,
        {
          provide: getRepositoryToken(OrderEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(InventoryEntity),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(BloodRequestEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(DonationEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: getQueueToken('donor-outreach'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<InventoryForecastingService>(
      InventoryForecastingService,
    );
    orderRepo = module.get<Repository<OrderEntity>>(
      getRepositoryToken(OrderEntity),
    );
    requestRepo = module.get<Repository<BloodRequestEntity>>(
      getRepositoryToken(BloodRequestEntity),
    );
    donationRepo = module.get<Repository<DonationEntity>>(
      getRepositoryToken(DonationEntity),
    );
    inventoryRepo = module.get<Repository<InventoryEntity>>(
      getRepositoryToken(InventoryEntity),
    );
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    outreachQueue = module.get(getQueueToken('donor-outreach'));

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateDemandForecasts', () => {
    it('should calculate forecasted demand from order history', async () => {
      const mockOrders = [
        {
          bloodType: 'A+',
          quantity: 10,
          deliveryAddress: 'City, Region1',
          createdAt: new Date(),
        },
        {
          bloodType: 'A+',
          quantity: 20,
          deliveryAddress: 'Town, Region1',
          createdAt: new Date(),
        },
        {
          bloodType: 'O-',
          quantity: 15,
          deliveryAddress: 'Village, Region2',
          createdAt: new Date(),
        },
      ];

      jest.spyOn(orderRepo, 'find').mockResolvedValue(mockOrders as any);
      jest.spyOn(requestRepo, 'find').mockResolvedValue([]);
      jest.spyOn(donationRepo, 'find').mockResolvedValue([]);
      jest
        .spyOn(inventoryRepo, 'find')
        .mockResolvedValue([{ bloodType: 'A+', region: 'Region1', quantity: 50 }] as any);

      const forecasts = await service.calculateDemandForecasts();

      expect(forecasts.length).toBeGreaterThan(0);
      expect(forecasts[0]).toHaveProperty('bloodType');
      expect(forecasts[0]).toHaveProperty('region');
      expect(forecasts[0]).toHaveProperty('averageDailyDemand');
      expect(forecasts[0]).toHaveProperty('projectedDaysOfSupply');
      expect(forecasts[0]).toHaveProperty('forecastedDemand');
    });

    it('should handle no order history', async () => {
      jest.spyOn(orderRepo, 'find').mockResolvedValue([]);
      jest.spyOn(requestRepo, 'find').mockResolvedValue([]);
      jest.spyOn(donationRepo, 'find').mockResolvedValue([]);
      jest.spyOn(inventoryRepo, 'find').mockResolvedValue([]);

      const forecasts = await service.calculateDemandForecasts();

      expect(forecasts).toEqual([]);
    });

    it('should handle single data point', async () => {
      const mockOrders = [
        {
          bloodType: 'AB+',
          quantity: 5,
          deliveryAddress: 'City, Region3',
          createdAt: new Date(),
        },
      ];

      jest.spyOn(orderRepo, 'find').mockResolvedValue(mockOrders as any);
      jest.spyOn(requestRepo, 'find').mockResolvedValue([]);
      jest.spyOn(donationRepo, 'find').mockResolvedValue([]);
      jest
        .spyOn(inventoryRepo, 'find')
        .mockResolvedValue([{ bloodType: 'AB+', region: 'Region3', quantity: 20 }] as any);

      const forecasts = await service.calculateDemandForecasts();

      expect(forecasts.length).toBe(1);
      expect(forecasts[0].bloodType).toBe('AB+');
      expect(forecasts[0].averageDailyDemand).toBeGreaterThan(0);
    });

    it('should return Infinity for zero demand', async () => {
      const mockOrders = [
        {
          bloodType: 'B-',
          quantity: 0,
          deliveryAddress: 'City, Region4',
          createdAt: new Date(),
        },
      ];

      jest.spyOn(orderRepo, 'find').mockResolvedValue(mockOrders as any);
      jest.spyOn(requestRepo, 'find').mockResolvedValue([]);
      jest.spyOn(donationRepo, 'find').mockResolvedValue([]);
      jest
        .spyOn(inventoryRepo, 'find')
        .mockResolvedValue([{ bloodType: 'B-', region: 'Region4', quantity: 100 }] as any);

      const forecasts = await service.calculateDemandForecasts();

      expect(forecasts[0].projectedDaysOfSupply).toBe(Infinity);
    });

    it('should handle zero stock', async () => {
      const mockOrders = [
        {
          bloodType: 'O+',
          quantity: 30,
          deliveryAddress: 'City, Region5',
          createdAt: new Date(),
        },
      ];

      jest.spyOn(orderRepo, 'find').mockResolvedValue(mockOrders as any);
      jest.spyOn(requestRepo, 'find').mockResolvedValue([]);
      jest.spyOn(donationRepo, 'find').mockResolvedValue([]);
      jest.spyOn(inventoryRepo, 'find').mockResolvedValue([]);

      const forecasts = await service.calculateDemandForecasts();

      expect(forecasts[0].currentStock).toBe(0);
      expect(forecasts[0].projectedDaysOfSupply).toBe(0);
    });

    it('uses blood requests and donation metadata to warm sparse series', async () => {
      jest.spyOn(orderRepo, 'find').mockResolvedValue([]);
      jest.spyOn(requestRepo, 'find').mockResolvedValue([
        {
          deliveryAddress: 'Clinic, Region6',
          createdAt: new Date(),
          items: [{ bloodType: 'O+', quantityMl: 450 }],
        },
      ] as any);
      jest.spyOn(donationRepo, 'find').mockResolvedValue([
        {
          metadata: {
            bloodType: 'O+',
            region: 'Region6',
            quantityMl: 450,
          },
        },
      ] as any);
      jest
        .spyOn(inventoryRepo, 'find')
        .mockResolvedValue([{ bloodType: 'O+', region: 'Region6', quantity: 10 }] as any);

      const forecasts = await service.calculateDemandForecasts();

      expect(forecasts).toHaveLength(1);
      expect(forecasts[0].bloodType).toBe('O+');
      expect(forecasts[0].seasonLength).toBe(7);
      expect(forecasts[0].forecastedDemand).toBeGreaterThan(0);
    });
  });

  describe('runForecast', () => {
    it('should emit InventoryLowEvent when stock falls below threshold', async () => {
      const mockForecasts = [
        {
          bloodType: 'A+',
          region: 'Region1',
          currentStock: 10,
          averageDailyDemand: 5,
          projectedDaysOfSupply: 2,
        },
      ];

      jest
        .spyOn(service, 'calculateDemandForecasts')
        .mockResolvedValue(mockForecasts);

      await service.runForecast();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'inventory.low',
        expect.any(InventoryLowEvent),
      );
    });

    it('should not emit event when stock is above threshold', async () => {
      const mockForecasts = [
        {
          bloodType: 'A+',
          region: 'Region1',
          currentStock: 100,
          averageDailyDemand: 5,
          projectedDaysOfSupply: 20,
        },
      ];

      jest
        .spyOn(service, 'calculateDemandForecasts')
        .mockResolvedValue(mockForecasts);

      await service.runForecast();

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('should enqueue donor outreach job for low inventory', async () => {
      const mockForecasts = [
        {
          bloodType: 'O-',
          region: 'Region2',
          currentStock: 5,
          averageDailyDemand: 3,
          projectedDaysOfSupply: 1.67,
        },
      ];

      jest
        .spyOn(service, 'calculateDemandForecasts')
        .mockResolvedValue(mockForecasts);

      await service.runForecast();

      expect(outreachQueue.add).toHaveBeenCalledWith(
        'recommend-donor-outreach',
        expect.objectContaining({
          bloodType: 'O-',
          region: 'Region2',
          urgency: expect.any(String),
        }),
      );
    });

    it('should use custom thresholds per blood type and region', async () => {
      const customConfigService = {
        get: jest.fn((key: string, defaultValue?: any) => {
          if (key === 'INVENTORY_FORECAST_THRESHOLDS') {
            return JSON.stringify([
              { bloodType: 'A+', region: 'Region1', daysThreshold: 5 },
            ]);
          }
          if (key === 'INVENTORY_FORECAST_SEASONALITY') {
            return JSON.stringify([
              { bloodType: 'A+', region: 'Region1', seasonLength: 14 },
            ]);
          }
          return mockConfigService.get(key, defaultValue);
        }),
      };

      const customModule = await Test.createTestingModule({
        providers: [
          InventoryForecastingService,
          {
            provide: getRepositoryToken(OrderEntity),
            useValue: { find: jest.fn() },
          },
          {
            provide: getRepositoryToken(InventoryEntity),
            useValue: { find: jest.fn(), findOne: jest.fn() },
          },
          {
            provide: getRepositoryToken(BloodRequestEntity),
            useValue: { find: jest.fn() },
          },
          {
            provide: getRepositoryToken(DonationEntity),
            useValue: { find: jest.fn() },
          },
          { provide: EventEmitter2, useValue: mockEventEmitter },
          { provide: ConfigService, useValue: customConfigService },
          { provide: getQueueToken('donor-outreach'), useValue: mockQueue },
        ],
      }).compile();

      const customService = customModule.get<InventoryForecastingService>(
        InventoryForecastingService,
      );

      const mockForecasts = [
        {
          bloodType: 'A+',
          region: 'Region1',
          currentStock: 20,
          averageDailyDemand: 5,
          projectedDaysOfSupply: 4,
        },
      ];

      jest
        .spyOn(customService, 'calculateDemandForecasts')
        .mockResolvedValue(mockForecasts);

      await customService.runForecast();

      expect(eventEmitter.emit).toHaveBeenCalled();
    });

    it('recalibrates thresholds and seasonality settings', async () => {
      jest.spyOn(service, 'calculateDemandForecasts').mockResolvedValue([]);

      const result = await service.recalibrate();

      expect(result.thresholdCount).toBeGreaterThanOrEqual(0);
      expect(result.seasonalityCount).toBeGreaterThanOrEqual(0);
      expect(result.forecastCount).toBe(0);
    });
  });
});
