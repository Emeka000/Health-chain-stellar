import { Processor, Process } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { Job } from 'bullmq';

import { OutboxService } from './outbox.service';

@Injectable()
@Processor('outbox-events')
export class OutboxConsumer {
  private readonly logger = new Logger(OutboxConsumer.name);

  constructor(
    private readonly outboxService: OutboxService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Process('publish-event')
  async handlePublishEvent(
    job: Job<{
      eventId: string;
      eventType: string;
      payload: Record<string, unknown>;
      aggregateId?: string;
      aggregateType?: string;
    }>,
  ): Promise<void> {
    const { eventId, eventType, payload, aggregateId, aggregateType } =
      job.data;

    try {
      // Emit event to internal listeners (notifications, blockchain hooks, etc.)
      this.eventEmitter.emit(eventType, {
        eventId,
        eventType,
        payload,
        aggregateId,
        aggregateType,
        timestamp: new Date(),
      });

      // Mark as published
      await this.outboxService.markAsPublished(eventId);

      this.logger.debug(`Published outbox event: ${eventType} (${eventId})`);
    } catch (error) {
      this.logger.error(
        `Failed to publish outbox event ${eventId}`,
        error instanceof Error ? error.message : String(error),
      );

      // Increment retry count and store error
      await this.outboxService.incrementRetryCount(
        eventId,
        error instanceof Error ? error.message : String(error),
      );

      throw error;
    }
  }
}
