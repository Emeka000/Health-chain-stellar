import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { Queue } from 'bullmq';

import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxProducer {
  private readonly logger = new Logger(OutboxProducer.name);

  constructor(
    private readonly outboxService: OutboxService,
    @InjectQueue('outbox-events') private readonly outboxQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async publishUnpublishedEvents(): Promise<void> {
    try {
      const events = await this.outboxService.getUnpublishedEvents(100);

      if (events.length === 0) {
        return;
      }

      for (const event of events) {
        await this.outboxQueue.add(
          'publish-event',
          {
            eventId: event.id,
            eventType: event.eventType,
            payload: event.payload,
            aggregateId: event.aggregateId,
            aggregateType: event.aggregateType,
          },
          {
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      }

      this.logger.debug(`Queued ${events.length} outbox events for publishing`);
    } catch (error) {
      this.logger.error('Failed to publish outbox events', error);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupPublishedEvents(): Promise<void> {
    try {
      const deleted = await this.outboxService.deletePublishedEvents(7);
      this.logger.log(`Cleaned up ${deleted} published outbox events`);
    } catch (error) {
      this.logger.error('Failed to cleanup outbox events', error);
    }
  }
}
