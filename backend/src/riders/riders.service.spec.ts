import { NotFoundException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { RiderEntity } from './entities/rider.entity';
import { RiderStatus } from './enums/rider-status.enum';
import { VehicleType } from './enums/vehicle-type.enum';
import { RidersService } from './riders.service';

describe('RidersService', () => {
  let service: RidersService;
  let repository: Repository<RiderEntity>;

  const mockRiderRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RidersService,
        {
          provide: getRepositoryToken(RiderEntity),
          useValue: mockRiderRepository,
        },
      ],
    }).compile();

    service = module.get<RidersService>(RidersService);
    repository = module.get<Repository<RiderEntity>>(
      getRepositoryToken(RiderEntity),
    );
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
      mockRiderRepository.create.mockReturnValue({
        ...registerDto,
        userId: 'user-1',
      });
      mockRiderRepository.save.mockResolvedValue({
        id: 'rider-1',
        ...registerDto,
        userId: 'user-1',
      });

      const result = await service.register('user-1', registerDto);

      expect(result.message).toContain('registration submitted');
      expect(mockRiderRepository.save).toHaveBeenCalled();
    });

    it('should throw ConflictException if rider already exists', async () => {
      mockRiderRepository.findOne.mockResolvedValue({ id: 'rider-1' });

      await expect(service.register('user-1', registerDto)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('verify', () => {
    it('should verify a rider', async () => {
      const rider = {
        id: 'rider-1',
        isVerified: false,
        status: RiderStatus.OFFLINE,
      };
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue({
        ...rider,
        isVerified: true,
        status: RiderStatus.AVAILABLE,
      });

      const result = await service.verify('rider-1');

      expect(result.data.isVerified).toBe(true);
      expect(result.data.status).toBe(RiderStatus.AVAILABLE);
    });

    it('should throw NotFoundException if rider not found', async () => {
      mockRiderRepository.findOne.mockResolvedValue(null);

      await expect(service.verify('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    it('should return all riders', async () => {
      const riders = [{ id: 'rider-1' }, { id: 'rider-2' }];
      mockRiderRepository.find.mockResolvedValue(riders);

      const result = await service.findAll();

      expect(result.data).toHaveLength(2);
      expect(mockRiderRepository.find).toHaveBeenCalled();
    });

    it('should filter by status', async () => {
      mockRiderRepository.find.mockResolvedValue([{ id: 'rider-1' }]);

      await service.findAll(RiderStatus.AVAILABLE);

      expect(mockRiderRepository.find).toHaveBeenCalledWith({
        where: { status: RiderStatus.AVAILABLE },
        relations: ['user'],
      });
    });
  });

  describe('findOne', () => {
    it('should return a rider by id', async () => {
      const rider = { id: 'rider-1' };
      mockRiderRepository.findOne.mockResolvedValue(rider);

      const result = await service.findOne('rider-1');

      expect(result.data.id).toBe('rider-1');
    });

    it('should throw NotFoundException if not found', async () => {
      mockRiderRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('any')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('should update rider status', async () => {
      const rider = { id: 'rider-1', status: RiderStatus.OFFLINE };
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue({
        ...rider,
        status: RiderStatus.AVAILABLE,
      });

      const result = await service.updateStatus(
        'rider-1',
        RiderStatus.AVAILABLE,
      );

      expect(result.data.status).toBe(RiderStatus.AVAILABLE);
    });
  });

  describe('updateLocation', () => {
    it('should update rider location', async () => {
      const rider = { id: 'rider-1', latitude: 0, longitude: 0 };
      mockRiderRepository.findOne.mockResolvedValue(rider);
      mockRiderRepository.save.mockResolvedValue({
        ...rider,
        latitude: 1.23,
        longitude: 4.56,
      });

      const result = await service.updateLocation('rider-1', 1.23, 4.56);

      expect(result.data.latitude).toBe(1.23);
      expect(result.data.longitude).toBe(4.56);
    });
  });

  describe('getAvailableRiders', () => {
    it('should return only verified and available riders', async () => {
      const riders = [{ id: 'rider-1' }];
      mockRiderRepository.find.mockResolvedValue(riders);

      const result = await service.getAvailableRiders();

      expect(result.data).toHaveLength(1);
      expect(mockRiderRepository.find).toHaveBeenCalledWith({
        where: { status: RiderStatus.AVAILABLE, isVerified: true },
      });
    });
  });

  describe('getNearbyRiders', () => {
    it('should filter riders by distance', async () => {
      const riders = [
        {
          id: 'near',
          latitude: 1.0,
          longitude: 1.0,
          status: RiderStatus.AVAILABLE,
          isVerified: true,
        },
        {
          id: 'far',
          latitude: 2.0,
          longitude: 2.0,
          status: RiderStatus.AVAILABLE,
          isVerified: true,
        },
        {
          id: 'no-coords',
          latitude: null,
          longitude: null,
          status: RiderStatus.AVAILABLE,
          isVerified: true,
        },
      ];
      mockRiderRepository.find.mockResolvedValue(riders);

      const result = await service.getNearbyRiders(1.0, 1.0, 10);

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('near');
    });
  });
});
