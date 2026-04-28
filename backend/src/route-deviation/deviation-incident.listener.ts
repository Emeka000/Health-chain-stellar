import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { RouteDeviationDetectedEvent } from '../events/route-deviation-detected.event';
import { IncidentRootCause } from '../incident-reviews/enums/incident-root-cause.enum';
import { IncidentSeverity } from '../incident-reviews/enums/incident-severity.enum';
import { IncidentReviewsService } from '../incident-reviews/incident-reviews.service';

import { DeviationSeverity } from './entities/route-deviation-incident.entity';
import { RouteDeviationService } from './route-deviation.service';

const SYSTEM_USER_ID = 'system';

@Injectable()
export class DeviationIncidentListener {
  private readonly logger = new Logger(DeviationIncidentListener.name);

  constructor(
    private readonly incidentReviewsService: IncidentReviewsService,
    private readonly deviationService: RouteDeviationService,
  ) {}

  @OnEvent('route.deviation.detected')
  async handleDeviationDetected(
    event: RouteDeviationDetectedEvent,
  ): Promise<void> {
    if (event.severity !== (DeviationSeverity.SEVERE as string)) return;

    try {
      await this.incidentReviewsService.create(
        {
          orderId: event.orderId,
          riderId: event.riderId,
          rootCause: IncidentRootCause.OTHER,
          severity: IncidentSeverity.HIGH,
          description: `Severe route deviation detected: rider deviated ${Math.round(event.deviationDistanceM)}m from planned corridor. ${event.recommendedAction ?? ''}`,
          affectsScoring: true,
          metadata: {
            deviationIncidentId: event.incidentId,
            deviationDistanceM: event.deviationDistanceM,
            lastKnownLatitude: event.lastKnownLatitude,
            lastKnownLongitude: event.lastKnownLongitude,
          },
        },
        SYSTEM_USER_ID,
      );

      await this.deviationService.markScoringApplied(event.incidentId);
      this.logger.log(
        `Incident review created for severe deviation incidentId=${event.incidentId}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to create incident review for deviation ${event.incidentId}: ${String(err)}`,
      );
    }
  }
}
