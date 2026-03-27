import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { LessThan, Repository } from 'typeorm';

import {
  BatchSaveLocationsDto,
  LocationQueryDto,
  RouteQueryDto,
  SaveLocationDto,
} from './dto/location-history.dto';
import { LocationHistoryEntity } from './entities/location-history.entity';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface PlaybackPoint extends LatLng {
  recordedAt: Date;
  /** Calculated speed in km/h between this and the previous point. Null for first. */
  speedKmh: number | null;
  /** Calculated bearing from previous point in degrees. Null for first. */
  bearing: number | null;
  accuracy: number | null;
  altitude: number | null;
}

export interface RoutePoint extends LatLng {
  recordedAt: Date;
}

export interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties: {
    orderId: string | null;
    riderId: string;
    pointCount: number;
    startTime: Date | null;
    endTime: Date | null;
    totalDistanceKm: number;
  };
}

/** Retention period in days. */
const RETENTION_DAYS = 30;

/** Default Douglas-Peucker epsilon in degrees (~11 m). */
const DEFAULT_DP_EPSILON = 0.0001;

@Injectable()
export class LocationHistoryService {
  private readonly logger = new Logger(LocationHistoryService.name);

  constructor(
    @InjectRepository(LocationHistoryEntity)
    private readonly locationRepository: Repository<LocationHistoryEntity>,
  ) {}

  // ── Write operations ────────────────────────────────────────────────

  async saveLocation(
    riderId: string,
    dto: SaveLocationDto,
  ): Promise<LocationHistoryEntity> {
    const entity = this.locationRepository.create({
      riderId,
      orderId: dto.orderId ?? null,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracy: dto.accuracy ?? null,
      speed: dto.speed ?? null,
      heading: dto.heading ?? null,
      altitude: dto.altitude ?? null,
      recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
    });

    return this.locationRepository.save(entity);
  }

  async batchSaveLocations(
    riderId: string,
    dto: BatchSaveLocationsDto,
  ): Promise<{ saved: number }> {
    const entities = dto.locations.map((loc) =>
      this.locationRepository.create({
        riderId,
        orderId: loc.orderId ?? null,
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy ?? null,
        speed: loc.speed ?? null,
        heading: loc.heading ?? null,
        altitude: loc.altitude ?? null,
        recordedAt: loc.recordedAt ? new Date(loc.recordedAt) : new Date(),
      }),
    );

    await this.locationRepository.insert(entities);
    return { saved: entities.length };
  }

  // ── Read operations ─────────────────────────────────────────────────

  async getLocationsByDelivery(
    orderId: string,
    query: LocationQueryDto = {},
  ): Promise<LocationHistoryEntity[]> {
    const qb = this.locationRepository
      .createQueryBuilder('loc')
      .where('loc.order_id = :orderId', { orderId })
      .orderBy('loc.recorded_at', 'ASC');

    if (query.from) {
      qb.andWhere('loc.recorded_at >= :from', { from: new Date(query.from) });
    }
    if (query.to) {
      qb.andWhere('loc.recorded_at <= :to', { to: new Date(query.to) });
    }
    if (query.limit) {
      qb.limit(query.limit);
    } else {
      qb.limit(1000);
    }

    const results = await qb.getMany();
    if (results.length === 0) {
      const exists = await this.locationRepository.findOne({
        where: { orderId },
        select: ['id'],
      });
      if (!exists) {
        throw new NotFoundException(
          `No location history found for delivery ${orderId}`,
        );
      }
    }

    return results;
  }

  async reconstructRoute(
    orderId: string,
    query: RouteQueryDto = {},
  ): Promise<RoutePoint[]> {
    const points = await this.getLocationsByDelivery(orderId, query);
    const epsilon = query.epsilon ?? DEFAULT_DP_EPSILON;

    const routePoints: RoutePoint[] = points.map((p) => ({
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      recordedAt: p.recordedAt,
    }));

    return douglasPeucker(routePoints, epsilon);
  }

  async getPlaybackData(
    orderId: string,
    query: LocationQueryDto = {},
  ): Promise<{
    orderId: string;
    points: PlaybackPoint[];
    totalDistanceKm: number;
    durationSeconds: number | null;
  }> {
    const points = await this.getLocationsByDelivery(orderId, {
      ...query,
      limit: query.limit ?? 5000,
    });

    const playback: PlaybackPoint[] = points.map((p, i) => {
      if (i === 0) {
        return {
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
          recordedAt: p.recordedAt,
          speedKmh: null,
          bearing: null,
          accuracy: p.accuracy,
          altitude: p.altitude,
        };
      }

      const prev = points[i - 1];
      const distKm = haversineDistanceKm(
        Number(prev.latitude),
        Number(prev.longitude),
        Number(p.latitude),
        Number(p.longitude),
      );
      const dtSeconds =
        (p.recordedAt.getTime() - prev.recordedAt.getTime()) / 1000;
      const speedKmh = dtSeconds > 0 ? (distKm / dtSeconds) * 3600 : 0;
      const bearing = calculateBearing(
        Number(prev.latitude),
        Number(prev.longitude),
        Number(p.latitude),
        Number(p.longitude),
      );

      return {
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        recordedAt: p.recordedAt,
        speedKmh: Math.round(speedKmh * 10) / 10,
        bearing: Math.round(bearing),
        accuracy: p.accuracy,
        altitude: p.altitude,
      };
    });

    const totalDistanceKm = computeTotalDistance(
      points.map((p) => ({
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
      })),
    );
    const durationSeconds =
      points.length >= 2
        ? (points[points.length - 1].recordedAt.getTime() -
            points[0].recordedAt.getTime()) /
          1000
        : null;

    return { orderId, points: playback, totalDistanceKm, durationSeconds };
  }

  async getVisualizationData(
    orderId: string,
    query: RouteQueryDto = {},
  ): Promise<GeoJsonFeature> {
    const points = await this.reconstructRoute(orderId, query);

    const totalDistanceKm = computeTotalDistance(points);

    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: points.map((p) => [p.longitude, p.latitude]),
      },
      properties: {
        orderId,
        riderId: await this.getRiderIdForOrder(orderId),
        pointCount: points.length,
        startTime: points.length > 0 ? points[0].recordedAt : null,
        endTime:
          points.length > 0 ? points[points.length - 1].recordedAt : null,
        totalDistanceKm,
      },
    };
  }

  async getLocationsByRider(
    riderId: string,
    query: LocationQueryDto = {},
  ): Promise<LocationHistoryEntity[]> {
    const qb = this.locationRepository
      .createQueryBuilder('loc')
      .where('loc.rider_id = :riderId', { riderId })
      .orderBy('loc.recorded_at', 'DESC');

    if (query.from) {
      qb.andWhere('loc.recorded_at >= :from', { from: new Date(query.from) });
    }
    if (query.to) {
      qb.andWhere('loc.recorded_at <= :to', { to: new Date(query.to) });
    }
    qb.limit(query.limit ?? 1000);

    return qb.getMany();
  }

  // ── Cleanup job ─────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupOldLocations(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);

    try {
      const result = await this.locationRepository.delete({
        recordedAt: LessThan(cutoff),
      });
      const affected = result.affected ?? 0;
      if (affected > 0) {
        this.logger.log(
          `Location history cleanup: deleted ${affected} record(s) older than ${RETENTION_DAYS} days`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Location history cleanup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────

  private async getRiderIdForOrder(orderId: string): Promise<string> {
    const record = await this.locationRepository.findOne({
      where: { orderId },
      select: ['riderId'],
    });
    return record?.riderId ?? '';
  }
}

// ── Pure geo-math utilities (exported for testing) ────────────────────

/** Haversine great-circle distance in km. */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Bearing from point 1 to point 2 in degrees (0–360). */
export function calculateBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Total route distance in km from an ordered array of lat/lng points. */
export function computeTotalDistance(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceKm(
      points[i - 1].latitude,
      points[i - 1].longitude,
      points[i].latitude,
      points[i].longitude,
    );
  }
  return Math.round(total * 1000) / 1000;
}

/**
 * Douglas-Peucker polyline simplification.
 * Reduces the number of route points while preserving shape.
 * epsilon is in degrees (1° ≈ 111 km; 0.0001° ≈ 11 m).
 */
export function douglasPeucker<T extends LatLng>(
  points: T[],
  epsilon: number,
): T[] {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIdx = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistanceDeg(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

/** Perpendicular distance from point P to the line segment AB (in degrees). */
function perpendicularDistanceDeg(p: LatLng, a: LatLng, b: LatLng): number {
  const dx = b.longitude - a.longitude;
  const dy = b.latitude - a.latitude;

  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      (p.longitude - a.longitude) ** 2 + (p.latitude - a.latitude) ** 2,
    );
  }

  const t =
    ((p.longitude - a.longitude) * dx + (p.latitude - a.latitude) * dy) /
    (dx * dx + dy * dy);
  const tClamped = Math.max(0, Math.min(1, t));
  const closestX = a.longitude + tClamped * dx;
  const closestY = a.latitude + tClamped * dy;

  return Math.sqrt(
    (p.longitude - closestX) ** 2 + (p.latitude - closestY) ** 2,
  );
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
