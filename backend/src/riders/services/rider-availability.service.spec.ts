import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { RiderEntity } from '../entities/rider.entity';
import { RiderStatus } from '../enums/rider-status.enum';
import { VehicleType } from '../enums/vehicle-type.enum';
import { RiderAvailabilityService } from './rider-availability.service';

describe('RiderAvailabilityService', () => {
  let service: RiderAvailabilityService;

  const mockRiderRepository = {
    find: jest.fn(),
    save: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  function makeRider(overrides: Partial<RiderEntity> = {}): RiderEntity {
    return {
      id: 'rider-1',
      userId: 'user-1',
      vehicleType: VehicleType.MOTORCYCLE,
      vehicleNumber: 'ABC-123',
      licenseNumber: 'LIC-456',
      status: RiderStatus.AVAILABLE,
      latitude: null,
      longitude: null,
      lastLocationUpdatedAt: null,
      workingHours: null,
      preferredAreas: null,
      identityDocumentUrl: null,
      vehicleDocumentUrl: null,
      isVerified: true,
      completedDeliveries: 0,
      cancelledDeliveries: 0,
      failedDeliveries: 0,
      rating: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      user: null as any,
      ...overrides,
    } as RiderEntity;
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiderAvailabilityService,
        {
          provide: getRepositoryToken(RiderEntity),
          useValue: mockRiderRepository,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<RiderAvailabilityService>(RiderAvailabilityService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('autoOfflineInactiveRiders', () => {
    it('should mark inactive riders as OFFLINE', async () => {
      const staleTimestamp = new Date(Date.now() - 35 * 60 * 1000);
      const riders = [
        makeRider({ status: RiderStatus.AVAILABLE, lastLocationUpdatedAt: staleTimestamp }),
        makeRider({ id: 'rider-2', status: RiderStatus.BUSY, lastLocationUpdatedAt: staleTimestamp }),
      ];

      mockRiderRepository.find.mockResolvedValue(riders);
      mockRiderRepository.save.mockResolvedValue(riders);

      await service.autoOfflineInactiveRiders();

      expect(riders[0].status).toBe(RiderStatus.OFFLINE);
      expect(riders[1].status).toBe(RiderStatus.OFFLINE);
      expect(mockRiderRepository.save).toHaveBeenCalledWith(riders);
    });

    it('should emit rider.offline event for each inactive rider', async () => {
      const staleTimestamp = new Date(Date.now() - 35 * 60 * 1000);
      const rider = makeRider({ status: RiderStatus.AVAILABLE, lastLocationUpdatedAt: staleTimestamp });
      mockRiderRepository.find.mockResolvedValue([rider]);
      mockRiderRepository.save.mockResolvedValue([rider]);

      await service.autoOfflineInactiveRiders();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'rider.offline',
        expect.objectContaining({ riderId: rider.id, reason: 'inactivity' }),
      );
    });

    it('should emit rider.status.changed event for each inactive rider', async () => {
      const staleTimestamp = new Date(Date.now() - 35 * 60 * 1000);
      const rider = makeRider({ status: RiderStatus.AVAILABLE, lastLocationUpdatedAt: staleTimestamp });
      mockRiderRepository.find.mockResolvedValue([rider]);
      mockRiderRepository.save.mockResolvedValue([rider]);

      await service.autoOfflineInactiveRiders();

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'rider.status.changed',
        expect.objectContaining({
          riderId: rider.id,
          newStatus: RiderStatus.OFFLINE,
          reason: 'inactivity',
        }),
      );
    });

    it('should do nothing when no inactive riders exist', async () => {
      mockRiderRepository.find.mockResolvedValue([]);

      await service.autoOfflineInactiveRiders();

      expect(mockRiderRepository.save).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });
  });
});
