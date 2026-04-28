import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Repository } from 'typeorm';

import { RiderEntity } from './entities/rider.entity';
import { RiderStatus } from './enums/rider-status.enum';
import { VehicleType } from './enums/vehicle-type.enum';
import { RidersService } from './riders.service';

describe('RidersService', () => {
  let service: RidersService;
  let repository: Repository<RiderEntity>;
  let eventEmitter: EventEmitter2;

  const mockRiderRepository = {
    find: jest.fn(),
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
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
      status: RiderStatus.OFFLINE,
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
        RidersService,
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

    service = module.get<RidersService>(RidersService);
    repository = module.get<Repository<RiderEntity>>(
      getRepositoryToken(RiderEntity),
    );
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const registerDto = {
      vehicleType: VehicleType.MOTORCYCLE,
      vehicleNumber: 'ABC-123',
      licenseNumber: 'LIC-456',
      identityDocumentUrl: 'http://docs.com/id.pdf',
      vehicleDocumentUrl: 'http://docs.com/veh.pdf',
    };

    it('should register a new rider', async () => {
      mockRiderRepository.findOne.mockResolvedValue(null);
      mockRiderRepository.create.mockReturnValue({ ...registerDto, userId: 'user-1' });
      mockRiderRepository.save.mockResolvedValue(makeRider());

      const result = await service.register('user-1', registerDto);

      expect(result.message).toContain('registration submitted');
      expect(mockRiderRepository.save).toHaveBeenCalled();
    });

    it('should throw ConflictException if rider already exists', async () => {
      mockRiderRepository.findOne.mockResolvedValue(makeRider());

      await expect(service.register('user-1', registerDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated riders', async () => {
      const riders = [makeRider(), makeRider({ id: 'rider-2' })];
      mockRiderRepository.findAndCount.mockResolvedValue([riders, 2]);

      const result = await service.findAll();

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });

    it('should filter by status when provided', async () => {
      mockRiderRepository.findAndCount.mockResolvedValue([[makeRider({ status: RiderStatus.AVAILABLE })], 1]);

      await service.findAll(RiderStatus.AVAILABLE);

      expect(mockRiderRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: RiderStatus.AVAILABLE } }),
      );
    });
  });

  describe('findOne', () => {
    it('should return a rider by id', async () => {
      mockRiderRepository.findOne.mockResolvedValue(makeRider());

      const result = await service.findOne('rider-1');

      expect(result.data.id).toBe('rider-1');
    });

    it('should throw NotFoundException if not found', async () => {
      mockRiderRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('verify', () => {
    it('should verify a rider and set status to AVAILABLE when OFFLINE', async () => {
      const rider = makeRider({ isVerified: false, status: RiderStatus.OFFLINE });
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue({ ...rider, isVerified: true, status: RiderStatus.AVAILABLE });

      const result = await service.verify('rider-1');

      expect(result.data.isVerified).toBe(true);
      expect(result.data.status).toBe(RiderStatus.AVAILABLE);
    });

    it('should throw NotFoundException if rider not found', async () => {
      mockRiderRepository.findOne.mockResolvedValue(null);

      await expect(service.verify('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('should update status for a valid transition (OFFLINE → AVAILABLE)', async () => {
      const rider = makeRider({ status: RiderStatus.OFFLINE });
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue({ ...rider, status: RiderStatus.AVAILABLE });

      const result = await service.updateStatus('rider-1', { status: RiderStatus.AVAILABLE });

      expect(result.data.status).toBe(RiderStatus.AVAILABLE);
    });

    it('should update status for AVAILABLE → OFFLINE transition', async () => {
      const rider = makeRider({ status: RiderStatus.AVAILABLE });
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue({ ...rider, status: RiderStatus.OFFLINE });

      const result = await service.updateStatus('rider-1', { status: RiderStatus.OFFLINE });

      expect(result.data.status).toBe(RiderStatus.OFFLINE);
    });

    it('should update status for AVAILABLE → BUSY transition', async () => {
      const rider = makeRider({ status: RiderStatus.AVAILABLE });
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue({ ...rider, status: RiderStatus.BUSY });

      const result = await service.updateStatus('rider-1', { status: RiderStatus.BUSY });

      expect(result.data.status).toBe(RiderStatus.BUSY);
    });

    it('should update status for BUSY → AVAILABLE transition', async () => {
      const rider = makeRider({ status: RiderStatus.BUSY });
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue({ ...rider, status: RiderStatus.AVAILABLE });

      const result = await service.updateStatus('rider-1', { status: RiderStatus.AVAILABLE });

      expect(result.data.status).toBe(RiderStatus.AVAILABLE);
    });

    it('should reject invalid transition (OFFLINE → ON_DELIVERY)', async () => {
      const rider = makeRider({ status: RiderStatus.OFFLINE });
      mockRiderRepository.findOne.mockResolvedValue(rider);

      await expect(
        service.updateStatus('rider-1', { status: RiderStatus.ON_DELIVERY }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid transition (OFFLINE → BUSY)', async () => {
      const rider = makeRider({ status: RiderStatus.OFFLINE });
      mockRiderRepository.findOne.mockResolvedValue(rider);

      await expect(
        service.updateStatus('rider-1', { status: RiderStatus.BUSY }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid transition (ON_DELIVERY → BUSY)', async () => {
      const rider = makeRider({ status: RiderStatus.ON_DELIVERY });
      mockRiderRepository.findOne.mockResolvedValue(rider);

      await expect(
        service.updateStatus('rider-1', { status: RiderStatus.BUSY }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should emit rider.online event when going OFFLINE → AVAILABLE', async () => {
      const rider = makeRider({ status: RiderStatus.OFFLINE });
      const saved = makeRider({ status: RiderStatus.AVAILABLE });
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue(saved);

      await service.updateStatus('rider-1', { status: RiderStatus.AVAILABLE });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'rider.online',
        expect.objectContaining({ riderId: saved.id }),
      );
    });

    it('should emit rider.offline event when going AVAILABLE → OFFLINE', async () => {
      const rider = makeRider({ status: RiderStatus.AVAILABLE });
      const saved = makeRider({ status: RiderStatus.OFFLINE });
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue(saved);

      await service.updateStatus('rider-1', { status: RiderStatus.OFFLINE });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'rider.offline',
        expect.objectContaining({ riderId: saved.id }),
      );
    });

    it('should always emit rider.status.changed event', async () => {
      const rider = makeRider({ status: RiderStatus.AVAILABLE });
      const saved = makeRider({ status: RiderStatus.BUSY });
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue(saved);

      await service.updateStatus('rider-1', { status: RiderStatus.BUSY });

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'rider.status.changed',
        expect.objectContaining({
          riderId: saved.id,
          previousStatus: RiderStatus.AVAILABLE,
          newStatus: RiderStatus.BUSY,
        }),
      );
    });
  });

  describe('updateLocation', () => {
    it('should update location and set lastLocationUpdatedAt', async () => {
      const rider = makeRider();
      const now = new Date();
      const saved = makeRider({ latitude: 6.5244, longitude: 3.3792, lastLocationUpdatedAt: now });
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue(saved);

      const result = await service.updateLocation('rider-1', {
        latitude: 6.5244,
        longitude: 3.3792,
      });

      expect(result.data.latitude).toBe(6.5244);
      expect(result.data.longitude).toBe(3.3792);
      expect(result.data.lastLocationUpdatedAt).toBeInstanceOf(Date);
    });

    it('should throw NotFoundException if rider not found', async () => {
      mockRiderRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateLocation('missing', { latitude: 0, longitude: 0 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setWorkingHours', () => {
    it('should set working hours configuration', async () => {
      const rider = makeRider();
      const workingHours = { startHour: 8, endHour: 18, timezone: 'Africa/Lagos', daysOfWeek: [1, 2, 3, 4, 5] };
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue({ ...rider, workingHours });

      const result = await service.setWorkingHours('rider-1', workingHours);

      expect(result.data.workingHours).toEqual(workingHours);
      expect(result.message).toContain('Working hours updated');
    });

    it('should throw NotFoundException if rider not found', async () => {
      mockRiderRepository.findOne.mockResolvedValue(null);

      await expect(
        service.setWorkingHours('missing', { startHour: 8, endHour: 18 }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('setPreferredAreas', () => {
    it('should set preferred areas', async () => {
      const rider = makeRider();
      const areas = ['Lagos Island', 'Victoria Island'];
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue({ ...rider, preferredAreas: areas });

      const result = await service.setPreferredAreas('rider-1', areas);

      expect(result.data.preferredAreas).toEqual(areas);
    });
  });

  describe('queryAvailability', () => {
    it('should return available verified riders', async () => {
      const riders = [makeRider({ status: RiderStatus.AVAILABLE })];
      mockRiderRepository.find.mockResolvedValue(riders);

      const result = await service.queryAvailability({});

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it('should filter by area when provided', async () => {
      const riders = [
        makeRider({ preferredAreas: ['Lagos Island', 'Victoria Island'] }),
        makeRider({ id: 'rider-2', preferredAreas: ['Abuja'] }),
      ];
      mockRiderRepository.find.mockResolvedValue(riders);

      const result = await service.queryAvailability({ area: 'Lagos' });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('rider-1');
    });

    it('should filter by radius when coordinates and radiusKm provided', async () => {
      const riders = [
        makeRider({ latitude: 6.5244, longitude: 3.3792 }),
        makeRider({ id: 'rider-far', latitude: 10.0, longitude: 10.0 }),
      ];
      mockRiderRepository.find.mockResolvedValue(riders);

      const result = await service.queryAvailability({
        latitude: 6.5244,
        longitude: 3.3792,
        radiusKm: 5,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('rider-1');
    });

    it('should exclude riders with null coordinates from radius filter', async () => {
      const riders = [
        makeRider({ latitude: null, longitude: null }),
      ];
      mockRiderRepository.find.mockResolvedValue(riders);

      const result = await service.queryAvailability({
        latitude: 6.5244,
        longitude: 3.3792,
        radiusKm: 50,
      });

      expect(result.data).toHaveLength(0);
    });
  });

  describe('getAvailableRiders', () => {
    it('should return only verified and available riders', async () => {
      const riders = [makeRider({ status: RiderStatus.AVAILABLE })];
      mockRiderRepository.find.mockResolvedValue(riders);

      const result = await service.getAvailableRiders();

      expect(result.data).toHaveLength(1);
      expect(mockRiderRepository.find).toHaveBeenCalledWith({
        where: { status: RiderStatus.AVAILABLE, isVerified: true },
      });
    });
  });

  describe('getNearbyRiders', () => {
    it('should return only riders within radius', async () => {
      const riders = [
        makeRider({ id: 'near', latitude: 6.5244, longitude: 3.3792 }),
        makeRider({ id: 'far', latitude: 10.0, longitude: 10.0 }),
        makeRider({ id: 'no-coords', latitude: null, longitude: null }),
      ];
      mockRiderRepository.find.mockResolvedValue(riders);

      const result = await service.getNearbyRiders(6.5244, 3.3792, 5);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('near');
    });
  });
});
