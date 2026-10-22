import { randomUUID } from 'crypto';

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { OutboxService } from './outbox.service';
import { OutboxEventEntity } from './outbox-event.entity';

const BATCH_SIZE = 50;

/**
 * Lease-based outbox dispatcher.
 * Polls PENDING events, acquires a lease, delivers via EventEmitter2,
 * and marks as published. Failed events get exponential backoff;
 * exhausted events are moved to dead-letter.
 */
@Injectable()
export class OutboxProducer implements OnModuleInit {
  private readonly logger = new Logger(OutboxProducer.name);
  private readonly workerId = `dispatcher-${randomUUID().slice(0, 8)}`;

  constructor(
    private readonly outboxService: OutboxService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    this.logger.log(`Outbox dispatcher started workerId=${this.workerId}`);
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async dispatchPendingEvents(): Promise<void> {
    try {
      const events = await this.outboxService.claimPendingEvents(
        this.workerId,
        BATCH_SIZE,
      );

      if (!events.length) return;

      this.logger.debug(
        `Dispatching ${events.length} outbox events workerId=${this.workerId}`,
      );

      await Promise.allSettled(events.map((e) => this.deliver(e)));
    } catch (err) {
      this.logger.error('Outbox dispatcher poll failed', err);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupPublishedEvents(): Promise<void> {
    try {
      const deleted = await this.outboxService.deletePublishedEvents(7);
      this.logger.log(`Cleaned up ${deleted} published outbox events`);
    } catch (err) {
      this.logger.error('Failed to cleanup outbox events', err);
    }
  }

  private async deliver(event: OutboxEventEntity): Promise<void> {
    // Heartbeat: renew lease mid-delivery for long-running handlers
    const heartbeat = setInterval(
      () => this.outboxService.renewLease(event.id, this.workerId).catch(() => {}),
      10_000,
    );

    try {
      await this.eventEmitter.emitAsync(event.eventType, {
        eventId: event.id,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        correlationId: event.correlationId,
        payload: event.payload,
        timestamp: new Date(),
      });

      await this.outboxService.markPublished(event.id);
      this.logger.debug(
        `Published outbox event ${event.id} (${event.eventType})`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Outbox event ${event.id} delivery failed: ${message}`,
      );
      await this.outboxService.recordFailure(event.id, message);
    } finally {
      clearInterval(heartbeat);
    }
  }
}
