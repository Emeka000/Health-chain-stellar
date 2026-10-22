import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.constants';

import { In, Repository } from 'typeorm';

import { RouteDeviationDetectedEvent } from '../events/route-deviation-detected.event';
import { haversineDistanceKm } from '../location-history/location-history.service';

import {
  CreatePlannedRouteDto,
  LocationUpdateDto,
} from './dto/route-deviation.dto';
import { PlannedRouteEntity } from './entities/planned-route.entity';
import {
  DeviationSeverity,
  DeviationStatus,
  RouteDeviationIncidentEntity,
} from './entities/route-deviation-incident.entity';
import { PaginatedResponse } from '../common/interfaces/paginated-response.interface';

/** Decode a Google-encoded polyline into lat/lng pairs. */
function decodePolyline(encoded: string): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
  }
  return points;
}

/** Minimum perpendicular distance in metres from point P to polyline. */
function minDistanceToPolylineM(
  lat: number,
  lng: number,
  polyline: Array<{ lat: number; lng: number }>,
): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) {
    return (
      haversineDistanceKm(lat, lng, polyline[0].lat, polyline[0].lng) * 1000
    );
  }

  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const dist = pointToSegmentDistanceM(lat, lng, a.lat, a.lng, b.lat, b.lng);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

const TELEMETRY_WINDOW_SIZE = 5;
const ENTRY_HYSTERESIS_FACTOR = 1.1;
const EXIT_HYSTERESIS_FACTOR = 0.9;

interface TelemetrySample {
  latitude: number;
  longitude: number;
  distanceM: number;
  recordedAt: Date;
}

interface OffCorridorState {
  firstOffAt: Date;
  lastDistanceM: number;
  smoothedDistanceM: number;
  sampleCount: number;
}

function pointToSegmentDistanceM(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dx = bLng - aLng;
  const dy = bLat - aLat;
  if (dx === 0 && dy === 0) {
    return haversineDistanceKm(pLat, pLng, aLat, aLng) * 1000;
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((pLng - aLng) * dx + (pLat - aLat) * dy) / (dx * dx + dy * dy),
    ),
  );
  return haversineDistanceKm(pLat, pLng, aLat + t * dy, aLng + t * dx) * 1000;
}

function classifySeverity(
  distanceM: number,
  durationS: number,
): DeviationSeverity {
  if (distanceM > 1000 || durationS > 300) return DeviationSeverity.SEVERE;
  if (distanceM > 500 || durationS > 120) return DeviationSeverity.MODERATE;
  return DeviationSeverity.MINOR;
}

function recommendedAction(severity: DeviationSeverity): string {
  switch (severity) {
    case DeviationSeverity.SEVERE:
      return 'Contact rider immediately and consider reassigning the delivery.';
    case DeviationSeverity.MODERATE:
      return 'Ping rider for status update and monitor closely.';
    default:
      return 'Monitor rider position — minor deviation detected.';
  }
}

@Injectable()
export class RouteDeviationService {
  private readonly logger = new Logger(RouteDeviationService.name);

  private readonly telemetryBuffers = new Map<string, TelemetrySample[]>();

  constructor(
    @InjectRepository(PlannedRouteEntity)
    private readonly plannedRouteRepo: Repository<PlannedRouteEntity>,
    @InjectRepository(RouteDeviationIncidentEntity)
    private readonly incidentRepo: Repository<RouteDeviationIncidentEntity>,
    private readonly eventEmitter: EventEmitter2,
    private readonly featureExtractor: SeverityFeatureExtractorService,
    private readonly classifier: SeverityClassifierService,
    private readonly triageAutomation: TriageAutomationService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) { }

  private offCorridorKey(riderId: string): string {
    return `route-deviation:off-corridor:${riderId}`;
  }

  private async getOffCorridorState(riderId: string): Promise<OffCorridorState | null> {
    const raw = await this.redis.get(this.offCorridorKey(riderId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return { ...parsed, firstOffAt: new Date(parsed.firstOffAt) };
  }

  private async setOffCorridorState(riderId: string, state: OffCorridorState): Promise<void> {
    await this.redis.set(
      this.offCorridorKey(riderId),
      JSON.stringify({ ...state, firstOffAt: state.firstOffAt.toISOString() }),
      'EX',
      600,
    );
  }

  private async deleteOffCorridorState(riderId: string): Promise<void> {
    await this.redis.del(this.offCorridorKey(riderId));
  }

  // ── Planned route management ─────────────────────────────────────────

  async createPlannedRoute(
    dto: CreatePlannedRouteDto,
  ): Promise<PlannedRouteEntity> {
    // Deactivate any existing active route for this order
    await this.plannedRouteRepo.update(
      { orderId: dto.orderId, isActive: true },
      { isActive: false },
    );

    const route = this.plannedRouteRepo.create({
      orderId: dto.orderId,
      riderId: dto.riderId,
      polyline: dto.polyline,
      checkpoints: dto.checkpoints ?? [],
      corridorRadiusM: dto.corridorRadiusM ?? 300,
      maxDeviationSeconds: dto.maxDeviationSeconds ?? 120,
      isActive: true,
    });

    const saved = await this.plannedRouteRepo.save(route);
    this.logger.log(
      `Planned route created for order=${dto.orderId} rider=${dto.riderId}`,
    );
    return saved;
  }

  async getActivePlannedRoute(
    orderId: string,
  ): Promise<PlannedRouteEntity | null> {
    return this.plannedRouteRepo.findOne({
      where: { orderId, isActive: true },
    });
  }

  // ── Location ingestion & deviation check ────────────────────────────

  async ingestLocationUpdate(dto: LocationUpdateDto): Promise<void> {
    const route = await this.getActivePlannedRoute(dto.orderId);
    if (!route) return; // No active planned route — nothing to check

    const polylinePoints = decodePolyline(route.polyline);
    const distanceM = minDistanceToPolylineM(
      dto.latitude,
      dto.longitude,
      polylinePoints,
    );

    const telemetry = this.appendTelemetrySample(dto.riderId, dto, distanceM);
    const smoothedDistanceM = this.computeSmoothedDistance(telemetry);
    const jitterM = this.computeJitterM(telemetry);
    const entryThresholdM = route.corridorRadiusM * ENTRY_HYSTERESIS_FACTOR;
    const exitThresholdM = route.corridorRadiusM * EXIT_HYSTERESIS_FACTOR;

    if (smoothedDistanceM <= exitThresholdM) {
      // Back on corridor — clear off-corridor state once the smoothed path settles.
      await this.deleteOffCorridorState(dto.riderId);
      return;
    }

    if (smoothedDistanceM <= entryThresholdM) {
      // Temporary excursion inside the hysteresis band — keep collecting samples.
      return;
    }

    const now = new Date();
    const existing = await this.getOffCorridorState(dto.riderId);

    if (!existing) {
      await this.setOffCorridorState(dto.riderId, {
        firstOffAt: now,
        lastDistanceM: distanceM,
        smoothedDistanceM,
        sampleCount: telemetry.length,
      });
      return;
    }

    const durationS = (now.getTime() - existing.firstOffAt.getTime()) / 1000;
    if (durationS < route.maxDeviationSeconds) {
      await this.setOffCorridorState(dto.riderId, {
        ...existing,
        lastDistanceM: distanceM,
        smoothedDistanceM,
        sampleCount: telemetry.length,
      });
      return;
    }

    // Dedupe against any incident that is not yet resolved (OPEN or
    // ACKNOWLEDGED). Acknowledging an incident must not cause every later
    // off-corridor ping to spawn a duplicate incident, event and scoring review.
    const activeIncident = await this.incidentRepo.findOne({
      where: {
        orderId: dto.orderId,
        riderId: dto.riderId,
        status: In([DeviationStatus.OPEN, DeviationStatus.ACKNOWLEDGED]),
      },
    });

    if (activeIncident) {
      await this.setOffCorridorState(dto.riderId, {
        ...existing,
        lastDistanceM: distanceM,
        smoothedDistanceM,
        sampleCount: telemetry.length,
      });
      return;
    }

    const severity = classifySeverity(smoothedDistanceM, durationS);
    const incident = this.incidentRepo.create({
      orderId: dto.orderId,
      riderId: dto.riderId,
      plannedRouteId: route.id,
      status: DeviationStatus.OPEN,
      severity,
      distanceM: smoothedDistanceM,
      durationS,
      latitude: dto.latitude,
      longitude: dto.longitude,
      recommendedAction: recommendedAction(severity),
    });

    const saved = await this.incidentRepo.save(incident);

    this.eventEmitter.emit(
      'route.deviation.detected',
      new RouteDeviationDetectedEvent(saved),
    );

    this.logger.warn(
      `Route deviation detected order=${dto.orderId} rider=${dto.riderId} severity=${severity} distance=${smoothedDistanceM.toFixed(0)}m duration=${durationS.toFixed(0)}s`,
    );
  }

  private appendTelemetrySample(
    riderId: string,
    dto: LocationUpdateDto,
    distanceM: number,
  ): TelemetrySample[] {
    const buffer = this.telemetryBuffers.get(riderId) ?? [];
    buffer.push({
      latitude: dto.latitude,
      longitude: dto.longitude,
      distanceM,
      recordedAt: new Date(),
    });
    while (buffer.length > TELEMETRY_WINDOW_SIZE) buffer.shift();
    this.telemetryBuffers.set(riderId, buffer);
    return buffer;
  }

  private computeSmoothedDistance(telemetry: TelemetrySample[]): number {
    if (telemetry.length === 0) return 0;
    const sum = telemetry.reduce((acc, s) => acc + s.distanceM, 0);
    return sum / telemetry.length;
  }

  private computeJitterM(telemetry: TelemetrySample[]): number {
    if (telemetry.length < 2) return 0;
    let max = -Infinity;
    let min = Infinity;
    for (const s of telemetry) {
      if (s.distanceM > max) max = s.distanceM;
      if (s.distanceM < min) min = s.distanceM;
    }
    return max - min;
  }

  // ── Incident lifecycle ──────────────────────────────────────────────

  async acknowledgeIncident(
    incidentId: string,
    acknowledgedBy: string,
  ): Promise<RouteDeviationIncidentEntity> {
    const incident = await this.incidentRepo.findOne({
      where: { id: incidentId },
    });
    if (!incident) {
      throw new NotFoundException(`Incident ${incidentId} not found`);
    }

    incident.status = DeviationStatus.ACKNOWLEDGED;
    incident.acknowledgedBy = acknowledgedBy;
    incident.acknowledgedAt = new Date();
    return this.incidentRepo.save(incident);
  }

  async resolveIncident(
    incidentId: string,
    resolvedBy: string,
  ): Promise<RouteDeviationIncidentEntity> {
    const incident = await this.incidentRepo.findOne({
      where: { id: incidentId },
    });
    if (!incident) {
      throw new NotFoundException(`Incident ${incidentId} not found`);
    }

    incident.status = DeviationStatus.RESOLVED;
    incident.resolvedBy = resolvedBy;
    incident.resolvedAt = new Date();
    const saved = await this.incidentRepo.save(incident);

    await this.deleteOffCorridorState(incident.riderId);
    return saved;
  }

  async getRiderDeviationCount(riderId: string): Promise<number> {
    return this.incidentRepo.count({ where: { riderId } });
  }

  async listIncidents(
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedResponse<RouteDeviationIncidentEntity>> {
    const [items, total] = await this.incidentRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }
}
