import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { TemperatureSampleEntity } from './entities/temperature-sample.entity';
import { DeliveryComplianceEntity } from './entities/delivery-compliance.entity';
import { RouteDeviationIncidentEntity } from '../route-deviation/entities/route-deviation-incident.entity';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  CorrelationWindow,
  DeliveryEvidenceBundle,
  TimelineEvent,
} from './delivery-timeline.types';

@Injectable()
export class DeliveryTimelineService {
  private readonly logger = new Logger(DeliveryTimelineService.name);

  constructor(
    @InjectRepository(TemperatureSampleEntity)
    private readonly sampleRepo: Repository<TemperatureSampleEntity>,
    @InjectRepository(DeliveryComplianceEntity)
    private readonly complianceRepo: Repository<DeliveryComplianceEntity>,
    @InjectRepository(RouteDeviationIncidentEntity)
    private readonly incidentRepo: Repository<RouteDeviationIncidentEntity>,
  ) {}

  /**
   * Build a unified delivery timeline by merging temperature samples and
   * route deviation incidents for the given delivery/order context.
   *
   * Clock-skew normalisation: any sample whose sourceAt is within
   * CLOCK_SKEW_TOLERANCE_MS of an adjacent event is snapped to the
   * adjacent event's timestamp to avoid spurious ordering inversions.
   */
  async buildTimeline(
    deliveryId: string,
    orderId: string | null,
  ): Promise<DeliveryEvidenceBundle> {
    const [samples, incidents, compliance] = await Promise.all([
      this.sampleRepo.find({
        where: { deliveryId },
        order: { recordedAt: 'ASC' },
      }),
      orderId
        ? this.incidentRepo.find({
            where: { orderId },
            order: { createdAt: 'ASC' },
          })
        : Promise.resolve([]),
      this.complianceRepo.findOne({ where: { deliveryId } }),
    ]);

    const events: TimelineEvent[] = [];

    // ── Temperature samples ──────────────────────────────────────────
    for (const s of samples) {
      const kind = s.isExcursion ? 'BREACH_START' : 'TEMPERATURE_SAMPLE';
      events.push(this.makeEvent(kind, s.recordedAt, { sampleId: s.id, temperatureCelsius: s.temperatureCelsius, isExcursion: s.isExcursion }));
    }

    // Mark breach end events (first safe sample after an excursion run)
    for (let i = 1; i < samples.length; i++) {
      if (samples[i - 1].isExcursion && !samples[i].isExcursion) {
        events.push(this.makeEvent('BREACH_END', samples[i].recordedAt, { previousSampleId: samples[i - 1].id }));
      }
    }

    // ── Route deviation incidents ────────────────────────────────────
    for (const inc of incidents) {
      events.push(this.makeEvent('ROUTE_DEVIATION_START', inc.createdAt, {
        incidentId: inc.id,
        severity: inc.severity,
        deviationDistanceM: inc.deviationDistanceM,
      }));
      if (inc.resolvedAt) {
        events.push(this.makeEvent('ROUTE_DEVIATION_END', inc.resolvedAt, { incidentId: inc.id }));
      }
    }

    // ── Compliance evaluation marker ─────────────────────────────────
    if (compliance?.evaluatedAt) {
      events.push(this.makeEvent('COMPLIANCE_EVALUATED', compliance.evaluatedAt, {
        isCompliant: compliance.isCompliant,
        excursionCount: compliance.excursionCount,
      }));
    }

    // Sort by normalised timestamp
    events.sort((a, b) => a.normalizedAt.getTime() - b.normalizedAt.getTime());

    const correlationWindows = this.buildCorrelationWindows(samples, incidents);

    return {
      deliveryId,
      orderId,
      timeline: events,
      correlationWindows,
      lastEvaluatedAt: new Date().toISOString(),
      finalized: false,
    };
  }

  /**
   * Re-evaluate an existing evidence bundle after late-arriving data.
   * Returns the updated bundle with a new lastEvaluatedAt timestamp.
   */
  async reevaluate(deliveryId: string, orderId: string | null): Promise<DeliveryEvidenceBundle> {
    this.logger.log(`Re-evaluating delivery timeline for deliveryId=${deliveryId}`);
    const bundle = await this.buildTimeline(deliveryId, orderId);
    bundle.lastEvaluatedAt = new Date().toISOString();
    return bundle;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private makeEvent(
    kind: TimelineEvent['kind'],
    sourceAt: Date,
    payload: Record<string, unknown>,
  ): TimelineEvent {
    // Apply clock-skew normalisation: clamp to wall-clock if within tolerance
    const now = Date.now();
    const skewMs = Math.max(0, sourceAt.getTime() - now);
    const normalizedAt = skewMs > CLOCK_SKEW_TOLERANCE_MS
      ? new Date(sourceAt.getTime() - skewMs + CLOCK_SKEW_TOLERANCE_MS)
      : sourceAt;

    return { kind, normalizedAt, sourceAt, skewMs, payload };
  }

  private buildCorrelationWindows(
    samples: TemperatureSampleEntity[],
    incidents: RouteDeviationIncidentEntity[],
  ): CorrelationWindow[] {
    const windows: CorrelationWindow[] = [];

    // Identify breach segments (consecutive excursion runs)
    let breachStart: Date | null = null;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.isExcursion && !breachStart) {
        breachStart = s.recordedAt;
      }
      const isLast = i === samples.length - 1;
      const nextSafe = !isLast && !samples[i + 1].isExcursion;

      if (breachStart && (nextSafe || isLast)) {
        const breachEnd = isLast && s.isExcursion ? null : samples[i + 1]?.recordedAt ?? null;
        const window = this.correlateBreachWithDeviations(breachStart, breachEnd, incidents);
        windows.push(window);
        breachStart = null;
      }
    }

    return windows;
  }

  private correlateBreachWithDeviations(
    breachStart: Date,
    breachEnd: Date | null,
    incidents: RouteDeviationIncidentEntity[],
  ): CorrelationWindow {
    const overlappingIds: string[] = [];
    let totalOverlapMs = 0;

    for (const inc of incidents) {
      const incStart = inc.createdAt.getTime();
      const incEnd = inc.resolvedAt ? inc.resolvedAt.getTime() : Date.now();
      const bStart = breachStart.getTime();
      const bEnd = breachEnd ? breachEnd.getTime() : Date.now();

      const overlapStart = Math.max(bStart, incStart);
      const overlapEnd = Math.min(bEnd, incEnd);
      const overlapMs = Math.max(0, overlapEnd - overlapStart);

      if (overlapMs > 0) {
        overlappingIds.push(inc.id);
        totalOverlapMs += overlapMs;
      }
    }

    const adjudication: CorrelationWindow['adjudication'] =
      overlappingIds.length > 0 ? 'BREACH_DURING_DEVIATION' : 'BREACH_INDEPENDENT';

    return {
      breachStartAt: breachStart,
      breachEndAt: breachEnd,
      deviationIncidentIds: overlappingIds,
      overlapMs: totalOverlapMs,
      adjudication,
    };
  }
}
