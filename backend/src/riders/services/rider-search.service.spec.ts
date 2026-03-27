import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { RiderEntity } from '../entities/rider.entity';
import { RiderStatus } from '../enums/rider-status.enum';
import { VehicleType } from '../enums/vehicle-type.enum';

import { RiderSearchService } from './rider-search.service';

describe('RiderSearchService', () => {
  let service: RiderSearchService;
  let mockRepository: any;

  beforeEach(async () => {
    mockRepository = {
      find: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiderSearchService,
        {
          provide: getRepositoryToken(RiderEntity),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<RiderSearchService>(RiderSearchService);
  });

  describe('calculateDistance', () => {
    it('should calculate distance between two points correctly', () => {
      // Lagos coordinates
      const lat1 = 6.5244;
      const lon1 = 3.3792;
      // Abuja coordinates
      const lat2 = 9.0579;
      const lon2 = 7.4951;

      const distance = service.calculateDistance(lat1, lon1, lat2, lon2);

      // Distance between Lagos and Abuja is approximately 535 km
      expect(distance).toBeGreaterThan(500);
      expect(distance).toBeLessThan(600);
    });

    it('should return null when any coordinate is null', () => {
      expect(
        service.calculateDistance(null, 3.3792, 9.0579, 7.4951),
      ).toBeNull();
      expect(
        service.calculateDistance(6.5244, null, 9.0579, 7.4951),
      ).toBeNull();
      expect(
        service.calculateDistance(6.5244, 3.3792, null, 7.4951),
      ).toBeNull();
      expect(
        service.calculateDistance(6.5244, 3.3792, 9.0579, null),
      ).toBeNull();
    });

    it('should return 0 for same coordinates', () => {
      const distance = service.calculateDistance(
        6.5244,
        3.3792,
        6.5244,
        3.3792,
      );
      expect(distance).toBe(0);
    });

    it('should handle small distances correctly', () => {
      // Two points very close to each other
      const lat1 = 6.5244;
      const lon1 = 3.3792;
      const lat2 = 6.5245;
      const lon2 = 3.3793;

      const distance = service.calculateDistance(lat1, lon1, lat2, lon2);
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(1); // Less than 1 km
    });
  });

  describe('searchRiders', () => {
    it('should return riders sorted by distance', async () => {
      const mockRiders = [
        {
          id: 'rider-1',
          userId: 'user-1',
          vehicleType: VehicleType.MOTORCYCLE,
          status: RiderStatus.AVAILABLE,
          latitude: 6.5244,
          longitude: 3.3792,
          rating: 4.5,
          completedDeliveries: 100,
          cancelledDeliveries: 5,
          failedDeliveries: 2,
          isVerified: true,
        },
        {
          id: 'rider-2',
          userId: 'user-2',
          vehicleType: VehicleType.CAR,
          status: RiderStatus.AVAILABLE,
          latitude: 6.53,
          longitude: 3.38,
          rating: 4.8,
          completedDeliveries: 150,
          cancelledDeliveries: 3,
          failedDeliveries: 1,
          isVerified: true,
        },
      ];

      mockRepository.createQueryBuilder.mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRiders),
      });

      const result = await service.searchRiders({
        latitude: 6.5244,
        longitude: 3.3792,
        radiusKm: 10,
        availableOnly: true,
        limit: 20,
        offset: 0,
      });

      expect(result.data).toHaveLength(2);
      expect(result.data[0].distanceKm).toBeLessThanOrEqual(
        result.data[1].distanceKm,
      );
    });

    it('should filter by vehicle type', async () => {
      const mockRiders = [
        {
          id: 'rider-1',
          userId: 'user-1',
          vehicleType: VehicleType.MOTORCYCLE,
          status: RiderStatus.AVAILABLE,
          latitude: 6.5244,
          longitude: 3.3792,
          rating: 4.5,
          completedDeliveries: 100,
          cancelledDeliveries: 5,
          failedDeliveries: 2,
          isVerified: true,
        },
      ];

      mockRepository.createQueryBuilder.mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRiders),
      });

      const result = await service.searchRiders({
        latitude: 6.5244,
        longitude: 3.3792,
        vehicleType: VehicleType.MOTORCYCLE,
        availableOnly: true,
        limit: 20,
        offset: 0,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].vehicleType).toBe(VehicleType.MOTORCYCLE);
    });

    it('should filter by minimum rating', async () => {
      const mockRiders = [
        {
          id: 'rider-1',
          userId: 'user-1',
          vehicleType: VehicleType.MOTORCYCLE,
          status: RiderStatus.AVAILABLE,
          latitude: 6.5244,
          longitude: 3.3792,
          rating: 4.5,
          completedDeliveries: 100,
          cancelledDeliveries: 5,
          failedDeliveries: 2,
          isVerified: true,
        },
        {
          id: 'rider-2',
          userId: 'user-2',
          vehicleType: VehicleType.CAR,
          status: RiderStatus.AVAILABLE,
          latitude: 6.53,
          longitude: 3.38,
          rating: 3.5,
          completedDeliveries: 50,
          cancelledDeliveries: 10,
          failedDeliveries: 5,
          isVerified: true,
        },
      ];

      mockRepository.createQueryBuilder.mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRiders),
      });

      const result = await service.searchRiders({
        latitude: 6.5244,
        longitude: 3.3792,
        minRating: 4.0,
        availableOnly: true,
        limit: 20,
        offset: 0,
      });

      expect(result.data).toHaveLength(1);
      expect(result.data[0].rating).toBeGreaterThanOrEqual(4.0);
    });

    it('should filter by radius', async () => {
      const mockRiders = [
        {
          id: 'rider-1',
          userId: 'user-1',
          vehicleType: VehicleType.MOTORCYCLE,
          status: RiderStatus.AVAILABLE,
          latitude: 6.5244,
          longitude: 3.3792,
          rating: 4.5,
          completedDeliveries: 100,
          cancelledDeliveries: 5,
          failedDeliveries: 2,
          isVerified: true,
        },
        {
          id: 'rider-2',
          userId: 'user-2',
          vehicleType: VehicleType.CAR,
          status: RiderStatus.AVAILABLE,
          latitude: 9.0579,
          longitude: 7.4951,
          rating: 4.8,
          completedDeliveries: 150,
          cancelledDeliveries: 3,
          failedDeliveries: 1,
          isVerified: true,
        },
      ];

      mockRepository.createQueryBuilder.mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRiders),
      });

      const result = await service.searchRiders({
        latitude: 6.5244,
        longitude: 3.3792,
        radiusKm: 10,
        availableOnly: true,
        limit: 20,
        offset: 0,
      });

      // Only rider-1 should be within 10km radius
      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('rider-1');
    });

    it('should apply pagination correctly', async () => {
      const mockRiders = Array.from({ length: 25 }, (_, i) => ({
        id: `rider-${i}`,
        userId: `user-${i}`,
        vehicleType: VehicleType.MOTORCYCLE,
        status: RiderStatus.AVAILABLE,
        latitude: 6.5244 + i * 0.001,
        longitude: 3.3792 + i * 0.001,
        rating: 4.5,
        completedDeliveries: 100,
        cancelledDeliveries: 5,
        failedDeliveries: 2,
        isVerified: true,
      }));

      mockRepository.createQueryBuilder.mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockRiders),
      });

      const result = await service.searchRiders({
        latitude: 6.5244,
        longitude: 3.3792,
        radiusKm: 100,
        availableOnly: true,
        limit: 10,
        offset: 0,
      });

      expect(result.data).toHaveLength(10);
      expect(result.total).toBe(25);
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });
  });

  describe('findRidersForAssignment', () => {
    it('should return scored candidates sorted by total score', async () => {
      const mockRiders = [
        {
          id: 'rider-1',
          userId: 'user-1',
          vehicleType: VehicleType.MOTORCYCLE,
          status: RiderStatus.AVAILABLE,
          latitude: 6.5244,
          longitude: 3.3792,
          rating: 4.5,
          completedDeliveries: 100,
          cancelledDeliveries: 5,
          failedDeliveries: 2,
          isVerified: true,
        },
        {
          id: 'rider-2',
          userId: 'user-2',
          vehicleType: VehicleType.CAR,
          status: RiderStatus.AVAILABLE,
          latitude: 6.53,
          longitude: 3.38,
          rating: 4.8,
          completedDeliveries: 150,
          cancelledDeliveries: 3,
          failedDeliveries: 1,
          isVerified: true,
        },
      ];

      mockRepository.find.mockResolvedValue(mockRiders);

      const result = await service.findRidersForAssignment({
        latitude: 6.5244,
        longitude: 3.3792,
        maxCandidates: 5,
      });

      expect(result.data.candidates).toHaveLength(2);
      expect(result.data.selectedRider).toBeDefined();
      expect(result.data.candidates[0].score.totalScore).toBeGreaterThanOrEqual(
        result.data.candidates[1].score.totalScore,
      );
    });

    it('should consider vehicle type preference', async () => {
      const mockRiders = [
        {
          id: 'rider-1',
          userId: 'user-1',
          vehicleType: VehicleType.MOTORCYCLE,
          status: RiderStatus.AVAILABLE,
          latitude: 6.5244,
          longitude: 3.3792,
          rating: 4.5,
          completedDeliveries: 100,
          cancelledDeliveries: 5,
          failedDeliveries: 2,
          isVerified: true,
        },
        {
          id: 'rider-2',
          userId: 'user-2',
          vehicleType: VehicleType.CAR,
          status: RiderStatus.AVAILABLE,
          latitude: 6.5244,
          longitude: 3.3792,
          rating: 4.5,
          completedDeliveries: 100,
          cancelledDeliveries: 5,
          failedDeliveries: 2,
          isVerified: true,
        },
      ];

      mockRepository.find.mockResolvedValue(mockRiders);

      const result = await service.findRidersForAssignment({
        latitude: 6.5244,
        longitude: 3.3792,
        vehicleType: VehicleType.MOTORCYCLE,
        maxCandidates: 5,
      });

      // Motorcycle rider should be selected
      expect(result.data.selectedRider?.riderId).toBe('rider-1');
    });

    it('should limit candidates to maxCandidates', async () => {
      const mockRiders = Array.from({ length: 10 }, (_, i) => ({
        id: `rider-${i}`,
        userId: `user-${i}`,
        vehicleType: VehicleType.MOTORCYCLE,
        status: RiderStatus.AVAILABLE,
        latitude: 6.5244 + i * 0.001,
        longitude: 3.3792 + i * 0.001,
        rating: 4.5,
        completedDeliveries: 100,
        cancelledDeliveries: 5,
        failedDeliveries: 2,
        isVerified: true,
      }));

      mockRepository.find.mockResolvedValue(mockRiders);

      const result = await service.findRidersForAssignment({
        latitude: 6.5244,
        longitude: 3.3792,
        maxCandidates: 3,
      });

      expect(result.data.candidates).toHaveLength(3);
    });

    it('should return null selectedRider when no candidates', async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.findRidersForAssignment({
        latitude: 6.5244,
        longitude: 3.3792,
        maxCandidates: 5,
      });

      expect(result.data.candidates).toHaveLength(0);
      expect(result.data.selectedRider).toBeNull();
    });
  });

  describe('getRiderStatistics', () => {
    it('should return rider statistics', async () => {
      const mockRider = {
        id: 'rider-1',
        rating: 4.5,
        completedDeliveries: 100,
        cancelledDeliveries: 5,
        failedDeliveries: 2,
      };

      mockRepository.findOne.mockResolvedValue(mockRider);

      const result = await service.getRiderStatistics('rider-1');

      expect(result.totalDeliveries).toBe(107);
      expect(result.completionRate).toBeCloseTo(93.46, 1);
      expect(result.averageRating).toBe(4.5);
    });

    it('should throw error for non-existent rider', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(service.getRiderStatistics('non-existent')).rejects.toThrow(
        'Rider non-existent not found',
      );
    });
  });
});
