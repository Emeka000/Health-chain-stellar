import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { ReputationService } from '../../reputation/reputation.service';
import { IncidentReviewsService } from '../incident-reviews.service';
import { IncidentReviewClosedEvent } from '../events/incident-review-closed.event';

/**
 * Listens for closed incident reviews and applies a reputation penalty
 * to the associated rider when the review is flagged as affecting scoring.
 */
@Injectable()
export class IncidentScoringListener {
  private readonly logger = new Logger(IncidentScoringListener.name);

  constructor(
    private readonly reputationService: ReputationService,
    private readonly incidentReviewsService: IncidentReviewsService,
  ) {}

  @OnEvent('incident.review.closed')
  async handleIncidentReviewClosed(
    event: IncidentReviewClosedEvent,
  ): Promise<void> {
    if (!event.affectsScoring || !event.riderId) {
      return;
    }

    try {
      // Record as a failed delivery outcome to apply the reputation penalty
      await this.reputationService.recordDelivery(
        event.riderId,
        event.orderId,
        'failed',
      );

      await this.incidentReviewsService.markScoringApplied(event.reviewId);

      this.logger.log(
        `Scoring applied for incident review ${event.reviewId} on rider ${event.riderId}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to apply scoring for incident review ${event.reviewId}`,
        err,
      );
    }
  }
}
