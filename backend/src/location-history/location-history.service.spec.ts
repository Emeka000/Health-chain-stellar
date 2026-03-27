import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { LocationHistoryEntity } from './entities/location-history.entity';
import {
  calculateBearing,
  computeTotalDistance,
  douglasPeucker,
  haversineDistanceKm,
  LocationHistoryService,
} from './location-history.service';

const mockLocationRepository = {
  create: jest.fn(),
  save: jest.fn(),
  insert: jest.fn(),
  findOne: jest.fn(),
  delete: jest.fn(),
  createQueryBuilder: jest.fn(),
};

/** Builds a minimal LocationHistoryEntity. */
const makePoint = (
  lat: number,
  lng: number,
  orderId = 'order-1',
  riderId = 'rider-1',
  recordedAt?: Date,
): LocationHistoryEntity =>
  ({
    id: `${lat}-${lng}`,
    riderId,
    orderId,
    latitude: lat,
    longitude: lng,
    accuracy: null,
    speed: null,
    heading: null,
    altitude: null,
    recordedAt: recordedAt ?? new Date('2024-01-01T10:00:00Z'),
    createdAt: new Date(),
  }) as LocationHistoryEntity;

describe('LocationHistoryService', () => {
  let service: LocationHistoryService;

  const buildQb = (results: LocationHistoryEntity[]) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(results),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationHistoryService,
        {
          provide: getRepositoryToken(LocationHistoryEntity),
          useValue: mockLocationRepository,
        },
      ],
    }).compile();

    service = module.get<LocationHistoryService>(LocationHistoryService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ── saveLocation ──────────────────────────────────────────────────────

  describe('saveLocation', () => {
    it('saves a single location with all fields', async () => {
      const entity = makePoint(1.23, 4.56);
      mockLocationRepository.create.mockReturnValue(entity);
      mockLocationRepository.save.mockResolvedValue(entity);

      const result = await service.saveLocation('rider-1', {
        latitude: 1.23,
        longitude: 4.56,
        accuracy: 10,
        orderId: 'order-1',
        recordedAt: '2024-01-01T10:00:00Z',
      });

      expect(mockLocationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          riderId: 'rider-1',
          latitude: 1.23,
          longitude: 4.56,
          accuracy: 10,
          orderId: 'order-1',
        }),
      );
      expect(mockLocationRepository.save).toHaveBeenCalled();
      expect(result).toBe(entity);
    });

    it('defaults orderId and optional fields to null when not provided', async () => {
      const entity = makePoint(0, 0, null as any);
      mockLocationRepository.create.mockReturnValue(entity);
      mockLocationRepository.save.mockResolvedValue(entity);

      await service.saveLocation('rider-1', { latitude: 0, longitude: 0 });

      expect(mockLocationRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: null,
          accuracy: null,
          speed: null,
          heading: null,
          altitude: null,
        }),
      );
    });
  });

  // ── batchSaveLocations ────────────────────────────────────────────────

  describe('batchSaveLocations', () => {
    it('inserts all locations and returns saved count', async () => {
      const pts = [
        { latitude: 1, longitude: 2 },
        { latitude: 3, longitude: 4 },
        { latitude: 5, longitude: 6 },
      ];
      mockLocationRepository.create.mockImplementation((v) => v);
      mockLocationRepository.insert.mockResolvedValue({});

      const result = await service.batchSaveLocations('rider-1', {
        locations: pts as any,
      });

      expect(mockLocationRepository.insert).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ riderId: 'rider-1' }),
        ]),
      );
      expect(result.saved).toBe(3);
    });
  });

  // ── getLocationsByDelivery ────────────────────────────────────────────

  describe('getLocationsByDelivery', () => {
    it('returns ordered points for a known delivery', async () => {
      const points = [makePoint(1, 2), makePoint(3, 4)];
      mockLocationRepository.createQueryBuilder.mockReturnValue(
        buildQb(points),
      );

      const result = await service.getLocationsByDelivery('order-1');

      expect(result).toHaveLength(2);
    });

    it('throws NotFoundException when no records exist for the order', async () => {
      mockLocationRepository.createQueryBuilder.mockReturnValue(buildQb([]));
      mockLocationRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getLocationsByDelivery('order-unknown'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns empty array without throwing when order exists but query window is empty', async () => {
      mockLocationRepository.createQueryBuilder.mockReturnValue(buildQb([]));
      mockLocationRepository.findOne.mockResolvedValue({ id: 'some-id' });

      const result = await service.getLocationsByDelivery('order-1', {
        from: '2030-01-01T00:00:00Z',
      });

      expect(result).toEqual([]);
    });
  });

  // ── reconstructRoute ─────────────────────────────────────────────────

  describe('reconstructRoute', () => {
    it('returns simplified route via Douglas-Peucker', async () => {
      // 5 points along a straight horizontal line — middle 3 should be eliminated
      const t = (ms: number) => new Date(1_700_000_000_000 + ms);
      const points = [
        makePoint(0, 0, 'order-1', 'rider-1', t(0)),
        makePoint(0, 1, 'order-1', 'rider-1', t(1000)),
        makePoint(0, 2, 'order-1', 'rider-1', t(2000)),
        makePoint(0, 3, 'order-1', 'rider-1', t(3000)),
        makePoint(0, 4, 'order-1', 'rider-1', t(4000)),
      ];
      mockLocationRepository.createQueryBuilder.mockReturnValue(
        buildQb(points),
      );

      const route = await service.reconstructRoute('order-1', {
        epsilon: 0.001,
      });

      // Straight line — only endpoints survive after aggressive simplification
      expect(route.length).toBeLessThan(points.length);
      expect(route[0]).toMatchObject({ latitude: 0, longitude: 0 });
      expect(route[route.length - 1]).toMatchObject({
        latitude: 0,
        longitude: 4,
      });
    });

    it('returns both points unchanged for a 2-point route', async () => {
      const points = [makePoint(0, 0), makePoint(1, 1)];
      mockLocationRepository.createQueryBuilder.mockReturnValue(
        buildQb(points),
      );

      const route = await service.reconstructRoute('order-1');

      expect(route).toHaveLength(2);
    });
  });

  // ── getPlaybackData ───────────────────────────────────────────────────

  describe('getPlaybackData', () => {
    it('calculates speed and bearing for each point after the first', async () => {
      const t = (s: number) => new Date(1_700_000_000_000 + s * 1000);
      const points = [
        makePoint(0, 0, 'order-1', 'rider-1', t(0)),
        makePoint(0, 0.009, 'order-1', 'rider-1', t(60)), // ~1 km east in 60 s ≈ 60 km/h
      ];
      mockLocationRepository.createQueryBuilder.mockReturnValue(
        buildQb(points),
      );

      const {
        points: playback,
        totalDistanceKm,
        durationSeconds,
      } = await service.getPlaybackData('order-1');

      expect(playback[0].speedKmh).toBeNull();
      expect(playback[0].bearing).toBeNull();
      expect(playback[1].speedKmh).toBeGreaterThan(0);
      expect(playback[1].bearing).toBeGreaterThanOrEqual(0);
      expect(playback[1].bearing).toBeLessThan(360);
      expect(totalDistanceKm).toBeGreaterThan(0);
      expect(durationSeconds).toBe(60);
    });

    it('returns null durationSeconds for single-point route', async () => {
      mockLocationRepository.createQueryBuilder.mockReturnValue(
        buildQb([makePoint(1, 1)]),
      );

      const { durationSeconds } = await service.getPlaybackData('order-1');

      expect(durationSeconds).toBeNull();
    });
  });

  // ── getVisualizationData ──────────────────────────────────────────────

  describe('getVisualizationData', () => {
    it('returns a valid GeoJSON LineString feature', async () => {
      const points = [makePoint(1, 2), makePoint(3, 4)];
      mockLocationRepository.createQueryBuilder.mockReturnValue(
        buildQb(points),
      );
      mockLocationRepository.findOne.mockResolvedValue({ riderId: 'rider-1' });

      const geoJson = await service.getVisualizationData('order-1');

      expect(geoJson.type).toBe('Feature');
      expect(geoJson.geometry.type).toBe('LineString');
      expect(geoJson.geometry.coordinates).toHaveLength(2);
      // GeoJSON coords are [lng, lat]
      expect(geoJson.geometry.coordinates[0]).toEqual([2, 1]);
      expect(geoJson.properties.orderId).toBe('order-1');
      expect(typeof geoJson.properties.totalDistanceKm).toBe('number');
    });
  });

  // ── cleanupOldLocations ───────────────────────────────────────────────

  describe('cleanupOldLocations', () => {
    it('deletes records older than 30 days', async () => {
      mockLocationRepository.delete.mockResolvedValue({ affected: 42 });

      await service.cleanupOldLocations();

      expect(mockLocationRepository.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          recordedAt: expect.anything(),
        }),
      );
    });

    it('handles deletion errors without throwing', async () => {
      mockLocationRepository.delete.mockRejectedValue(new Error('DB timeout'));

      await expect(service.cleanupOldLocations()).resolves.not.toThrow();
    });
  });
});

// ── Pure math utilities ───────────────────────────────────────────────────

describe('haversineDistanceKm', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistanceKm(1, 1, 1, 1)).toBe(0);
  });

  it('approximates ~111 km per degree of latitude', () => {
    const dist = haversineDistanceKm(0, 0, 1, 0);
    expect(dist).toBeCloseTo(111.2, 0);
  });

  it('approximates ~111 km per degree of longitude at equator', () => {
    const dist = haversineDistanceKm(0, 0, 0, 1);
    expect(dist).toBeCloseTo(111.2, 0);
  });
});

describe('calculateBearing', () => {
  it('returns ~0° heading north', () => {
    expect(calculateBearing(0, 0, 1, 0)).toBeCloseTo(0, 0);
  });

  it('returns ~90° heading east', () => {
    expect(calculateBearing(0, 0, 0, 1)).toBeCloseTo(90, 0);
  });

  it('returns ~180° heading south', () => {
    expect(calculateBearing(1, 0, 0, 0)).toBeCloseTo(180, 0);
  });

  it('returns ~270° heading west', () => {
    expect(calculateBearing(0, 1, 0, 0)).toBeCloseTo(270, 0);
  });
});

describe('computeTotalDistance', () => {
  it('returns 0 for empty array', () => {
    expect(computeTotalDistance([])).toBe(0);
  });

  it('returns 0 for single point', () => {
    expect(computeTotalDistance([{ latitude: 1, longitude: 1 }])).toBe(0);
  });

  it('sums distances for multiple points', () => {
    const pts = [
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
      { latitude: 2, longitude: 0 },
    ];
    expect(computeTotalDistance(pts)).toBeCloseTo(222.4, 0);
  });
});

describe('douglasPeucker', () => {
  it('returns both points for a 2-point input', () => {
    const pts = [
      { latitude: 0, longitude: 0, recordedAt: new Date() },
      { latitude: 1, longitude: 1, recordedAt: new Date() },
    ];
    expect(douglasPeucker(pts, 0.01)).toHaveLength(2);
  });

  it('collapses collinear points with a large epsilon', () => {
    const pts = [
      { latitude: 0, longitude: 0, recordedAt: new Date() },
      { latitude: 0, longitude: 1, recordedAt: new Date() },
      { latitude: 0, longitude: 2, recordedAt: new Date() },
      { latitude: 0, longitude: 3, recordedAt: new Date() },
      { latitude: 0, longitude: 4, recordedAt: new Date() },
    ];
    const result = douglasPeucker(pts, 0.01);
    // All midpoints are on the line; only endpoints survive
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ latitude: 0, longitude: 0 });
    expect(result[result.length - 1]).toMatchObject({
      latitude: 0,
      longitude: 4,
    });
  });

  it('preserves a significant bend in the route', () => {
    const pts = [
      { latitude: 0, longitude: 0, recordedAt: new Date() },
      { latitude: 0.5, longitude: 2, recordedAt: new Date() }, // significant bend
      { latitude: 0, longitude: 4, recordedAt: new Date() },
    ];
    const result = douglasPeucker(pts, 0.0001);
    expect(result).toHaveLength(3);
  });

  it('returns single-point array unchanged', () => {
    const pts = [{ latitude: 1, longitude: 1, recordedAt: new Date() }];
    expect(douglasPeucker(pts, 0.01)).toHaveLength(1);
  });
});
