import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { RoutePlanningService } from './route-planning.service';

describe('RoutePlanningService', () => {
  let service: RoutePlanningService;
  let mockRedis: any;
  let mockConfigService: any;

  beforeEach(async () => {
    mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockReturnValue('test-api-key'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutePlanningService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: 'REDIS_CLIENT',
          useValue: mockRedis,
        },
      ],
    }).compile();

    service = module.get<RoutePlanningService>(RoutePlanningService);
  });

  describe('calculateHaversineDistance', () => {
    it('should calculate distance between two points correctly', () => {
      // Lagos coordinates
      const lat1 = 6.5244;
      const lon1 = 3.3792;
      // Abuja coordinates
      const lat2 = 9.0579;
      const lon2 = 7.4951;

      const distance = service['calculateHaversineDistance'](
        lat1,
        lon1,
        lat2,
        lon2,
      );

      // Distance between Lagos and Abuja is approximately 535 km
      expect(distance).toBeGreaterThan(500);
      expect(distance).toBeLessThan(600);
    });

    it('should return 0 for same coordinates', () => {
      const distance = service['calculateHaversineDistance'](
        6.5244,
        3.3792,
        6.5244,
        3.3792,
      );
      expect(distance).toBe(0);
    });

    it('should handle small distances correctly', () => {
      const lat1 = 6.5244;
      const lon1 = 3.3792;
      const lat2 = 6.5245;
      const lon2 = 3.3793;

      const distance = service['calculateHaversineDistance'](
        lat1,
        lon1,
        lat2,
        lon2,
      );
      expect(distance).toBeGreaterThan(0);
      expect(distance).toBeLessThan(1); // Less than 1 km
    });
  });

  describe('decodePolyline', () => {
    it('should decode polyline string correctly', () => {
      // Sample encoded polyline
      const encoded = 'u{wVf~}gO??';
      const decoded = service.decodePolyline(encoded);

      expect(decoded).toHaveLength(2);
      expect(decoded[0]).toHaveProperty('latitude');
      expect(decoded[0]).toHaveProperty('longitude');
    });

    it('should handle empty polyline', () => {
      const decoded = service.decodePolyline('');
      expect(decoded).toHaveLength(0);
    });

    it('should decode complex polyline', () => {
      // More complex encoded polyline
      const encoded = 'u{wVf~}gO??_kBwB??_kBwB??';
      const decoded = service.decodePolyline(encoded);

      expect(decoded.length).toBeGreaterThan(0);
      decoded.forEach((point) => {
        expect(point).toHaveProperty('latitude');
        expect(point).toHaveProperty('longitude');
        expect(typeof point.latitude).toBe('number');
        expect(typeof point.longitude).toBe('number');
      });
    });
  });

  describe('getRouteStatistics', () => {
    it('should calculate route statistics correctly', () => {
      const mockRoute = {
        distanceMeters: 10000, // 10 km
        durationSeconds: 1800, // 30 minutes
        startLocation: { latitude: 6.5244, longitude: 3.3792 },
        endLocation: { latitude: 6.5344, longitude: 3.3892 },
        steps: [
          {
            instruction: 'Turn right',
            distanceMeters: 5000,
            durationSeconds: 900,
            startLocation: { latitude: 6.5244, longitude: 3.3792 },
            endLocation: { latitude: 6.5294, longitude: 3.3842 },
            maneuver: 'turn-right',
          },
          {
            instruction: 'Continue straight',
            distanceMeters: 5000,
            durationSeconds: 900,
            startLocation: { latitude: 6.5294, longitude: 3.3842 },
            endLocation: { latitude: 6.5344, longitude: 3.3892 },
            maneuver: 'straight',
          },
        ],
        polyline: 'test-polyline',
        bounds: {
          northeast: { latitude: 6.5344, longitude: 3.3892 },
          southwest: { latitude: 6.5244, longitude: 3.3792 },
        },
      };

      const stats = service.getRouteStatistics(mockRoute);

      expect(stats.totalDistanceKm).toBe(10);
      expect(stats.totalDurationMinutes).toBe(30);
      expect(stats.averageSpeedKmh).toBe(20);
      expect(stats.stepCount).toBe(2);
    });

    it('should handle zero duration', () => {
      const mockRoute = {
        distanceMeters: 10000,
        durationSeconds: 0,
        startLocation: { latitude: 6.5244, longitude: 3.3792 },
        endLocation: { latitude: 6.5344, longitude: 3.3892 },
        steps: [],
        polyline: 'test-polyline',
        bounds: {
          northeast: { latitude: 6.5344, longitude: 3.3892 },
          southwest: { latitude: 6.5244, longitude: 3.3792 },
        },
      };

      const stats = service.getRouteStatistics(mockRoute);

      expect(stats.averageSpeedKmh).toBe(0);
    });
  });

  describe('optimizeStopOrder', () => {
    it('should optimize stop order using nearest neighbor', async () => {
      const stops = [
        { latitude: 6.5244, longitude: 3.3792, name: 'Stop A' },
        { latitude: 6.5344, longitude: 3.3892, name: 'Stop B' },
        { latitude: 6.5144, longitude: 3.3692, name: 'Stop C' },
      ];

      const optimized = await service['optimizeStopOrder'](stops, false);

      expect(optimized).toHaveLength(3);
      expect(optimized[0]).toEqual(stops[0]); // Should start with first stop
    });

    it('should return to start when requested', async () => {
      const stops = [
        { latitude: 6.5244, longitude: 3.3792, name: 'Stop A' },
        { latitude: 6.5344, longitude: 3.3892, name: 'Stop B' },
      ];

      const optimized = await service['optimizeStopOrder'](stops, true);

      expect(optimized).toHaveLength(3);
      expect(optimized[2]).toEqual(stops[0]); // Should return to start
    });

    it('should handle two stops', async () => {
      const stops = [
        { latitude: 6.5244, longitude: 3.3792, name: 'Stop A' },
        { latitude: 6.5344, longitude: 3.3892, name: 'Stop B' },
      ];

      const optimized = await service['optimizeStopOrder'](stops, false);

      expect(optimized).toHaveLength(2);
    });
  });

  describe('calculateRoute', () => {
    it('should use cached route if available', async () => {
      const cachedResponse = {
        message: 'Route calculated successfully',
        data: {
          route: {
            distanceMeters: 10000,
            durationSeconds: 1800,
            startLocation: { latitude: 6.5244, longitude: 3.3792 },
            endLocation: { latitude: 6.5344, longitude: 3.3892 },
            steps: [],
            polyline: 'test-polyline',
            bounds: {
              northeast: { latitude: 6.5344, longitude: 3.3892 },
              southwest: { latitude: 6.5244, longitude: 3.3792 },
            },
          },
        },
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResponse));

      const result = await service.calculateRoute({
        originLat: 6.5244,
        originLng: 3.3792,
        destLat: 6.5344,
        destLng: 3.3892,
      });

      expect(result).toEqual(cachedResponse);
      expect(mockRedis.get).toHaveBeenCalled();
    });

    it('should calculate new route when cache miss', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockRedis.setex.mockResolvedValue('OK');

      // Mock fetch
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'OK',
            routes: [
              {
                legs: [
                  {
                    distance: { value: 10000 },
                    duration: { value: 1800 },
                    start_location: { lat: 6.5244, lng: 3.3792 },
                    end_location: { lat: 6.5344, lng: 3.3892 },
                    steps: [],
                  },
                ],
                overview_polyline: { points: 'test-polyline' },
                bounds: {
                  northeast: { lat: 6.5344, lng: 3.3892 },
                  southwest: { lat: 6.5244, lng: 3.3792 },
                },
              },
            ],
          }),
      });

      const result = await service.calculateRoute({
        originLat: 6.5244,
        originLng: 3.3792,
        destLat: 6.5344,
        destLng: 3.3892,
      });

      expect(result.data.route.distanceMeters).toBe(10000);
      expect(result.data.route.durationSeconds).toBe(1800);
      expect(mockRedis.setex).toHaveBeenCalled();
    });
  });

  describe('calculateETA', () => {
    it('should calculate ETA with traffic', async () => {
      // Mock fetch
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'OK',
            routes: [
              {
                legs: [
                  {
                    distance: { value: 10000 },
                    duration: { value: 1800 },
                    duration_in_traffic: { value: 2100 },
                    start_location: { lat: 6.5244, lng: 3.3792 },
                    end_location: { lat: 6.5344, lng: 3.3892 },
                  },
                ],
              },
            ],
          }),
      });

      const result = await service.calculateETA(
        6.5244,
        3.3792,
        6.5344,
        3.3892,
        new Date(),
      );

      expect(result.data.durationSeconds).toBe(1800);
      expect(result.data.durationInTrafficSeconds).toBe(2100);
      expect(result.data.eta).toBeDefined();
    });
  });

  describe('getRouteStatistics', () => {
    it('should return correct statistics', () => {
      const mockRoute = {
        distanceMeters: 50000, // 50 km
        durationSeconds: 3600, // 1 hour
        startLocation: { latitude: 6.5244, longitude: 3.3792 },
        endLocation: { latitude: 6.5344, longitude: 3.3892 },
        steps: [
          {
            instruction: 'Turn right',
            distanceMeters: 25000,
            durationSeconds: 1800,
            startLocation: { latitude: 6.5244, longitude: 3.3792 },
            endLocation: { latitude: 6.5294, longitude: 3.3842 },
            maneuver: 'turn-right',
          },
          {
            instruction: 'Continue straight',
            distanceMeters: 25000,
            durationSeconds: 1800,
            startLocation: { latitude: 6.5294, longitude: 3.3842 },
            endLocation: { latitude: 6.5344, longitude: 3.3892 },
            maneuver: 'straight',
          },
        ],
        polyline: 'test-polyline',
        bounds: {
          northeast: { latitude: 6.5344, longitude: 3.3892 },
          southwest: { latitude: 6.5244, longitude: 3.3792 },
        },
      };

      const stats = service.getRouteStatistics(mockRoute);

      expect(stats.totalDistanceKm).toBe(50);
      expect(stats.totalDurationMinutes).toBe(60);
      expect(stats.averageSpeedKmh).toBe(50);
      expect(stats.stepCount).toBe(2);
    });
  });
});
