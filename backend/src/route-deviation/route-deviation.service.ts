import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

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

  /** riderId → { firstOffAt: Date, lastDistanceM: number } */
  private readonly offCorridorState = new Map<
    string,
    { firstOffAt: Date; lastDistanceM: number }
  >();

  constructor(
    @InjectRepository(PlannedRouteEntity)
    private readonly plannedRouteRepo: Repository<PlannedRouteEntity>,
    @InjectRepository(RouteDeviationIncidentEntity)
    private readonly incidentRepo: Repository<RouteDeviationIncidentEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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

    if (distanceM <= route.corridorRadiusM) {
      // Back on corridor — clear off-corridor state
      this.offCorridorState.delete(dto.riderId);
      return;
    }

    // Off corridor
    const now = new Date();
    const existing = this.offCorridorState.get(dto.riderId);

    if (!existing) {
      this.offCorridorState.set(dto.riderId, {
        firstOffAt: now,
        lastDistanceM: distanceM,
      });
      return; // First off-corridor ping — wait for duration threshold
    }

    const durationS = Math.floor(
      (now.getTime() - existing.firstOffAt.getTime()) / 1000,
    );
    this.offCorridorState.set(dto.riderId, {
      firstOffAt: existing.firstOffAt,
      lastDistanceM: distanceM,
    });

    if (durationS < route.maxDeviationSeconds) return; // Not yet past duration threshold

    // Check if there's already an open incident for this rider+order
    const openIncident = await this.incidentRepo.findOne({
      where: {
        orderId: dto.orderId,
        riderId: dto.riderId,
        status: DeviationStatus.OPEN,
      },
    });

    const severity = classifySeverity(distanceM, durationS);
    const action = recommendedAction(severity);

    if (openIncident) {
      // Update existing incident with latest position and severity
      openIncident.deviationDistanceM = distanceM;
      openIncident.deviationDurationS = durationS;
      openIncident.lastKnownLatitude = dto.latitude;
      openIncident.lastKnownLongitude = dto.longitude;
      openIncident.severity = severity;
      openIncident.recommendedAction = action;
      await this.incidentRepo.save(openIncident);
      return;
    }

    // Create new incident
    const incident = this.incidentRepo.create({
      orderId: dto.orderId,
      riderId: dto.riderId,
      plannedRouteId: route.id,
      severity,
      status: DeviationStatus.OPEN,
      deviationDistanceM: distanceM,
      deviationDurationS: durationS,
      lastKnownLatitude: dto.latitude,
      lastKnownLongitude: dto.longitude,
      reason: `Rider deviated ${Math.round(distanceM)}m from planned corridor for ${durationS}s`,
      recommendedAction: action,
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolvedAt: null,
      scoringApplied: false,
      metadata: null,
    });

    const saved = await this.incidentRepo.save(incident);
    this.logger.warn(
      `Route deviation incident created id=${saved.id} order=${dto.orderId} severity=${severity}`,
    );

    this.eventEmitter.emit(
      'route.deviation.detected',
      new RouteDeviationDetectedEvent(
        saved.id,
        dto.orderId,
        dto.riderId,
        severity,
        distanceM,
        dto.latitude,
        dto.longitude,
        action,
      ),
    );
  }

  // ── Incident management ──────────────────────────────────────────────

  async acknowledgeIncident(
    incidentId: string,
    userId: string,
  ): Promise<RouteDeviationIncidentEntity> {
    const incident = await this.incidentRepo.findOne({
      where: { id: incidentId },
    });
    if (!incident)
      throw new NotFoundException(`Deviation incident ${incidentId} not found`);

    if (incident.acknowledgedAt) return incident;

    incident.status = DeviationStatus.ACKNOWLEDGED;
    incident.acknowledgedBy = userId;
    incident.acknowledgedAt = new Date();
    return this.incidentRepo.save(incident);
  }

  async resolveIncident(
    incidentId: string,
  ): Promise<RouteDeviationIncidentEntity> {
    const incident = await this.incidentRepo.findOne({
      where: { id: incidentId },
    });
    if (!incident)
      throw new NotFoundException(`Deviation incident ${incidentId} not found`);

    incident.status = DeviationStatus.RESOLVED;
    incident.resolvedAt = new Date();
    this.offCorridorState.delete(incident.riderId);
    return this.incidentRepo.save(incident);
  }

  async findOpenIncidents(): Promise<RouteDeviationIncidentEntity[]> {
    return this.incidentRepo.find({
      where: { status: DeviationStatus.OPEN },
      order: { createdAt: 'DESC' },
    });
  }

  async findIncidentsByOrder(
    orderId: string,
  ): Promise<RouteDeviationIncidentEntity[]> {
    return this.incidentRepo.find({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  async markScoringApplied(incidentId: string): Promise<void> {
    await this.incidentRepo.update(incidentId, { scoringApplied: true });
  }
}
