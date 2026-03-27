import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository, LessThan } from 'typeorm';

import { OutboxEventEntity, OutboxEventType } from './outbox-event.entity';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    @InjectRepository(OutboxEventEntity)
    private readonly outboxRepository: Repository<OutboxEventEntity>,
  ) {}

  async publishEvent(
    eventType: OutboxEventType | string,
    payload: Record<string, unknown>,
    aggregateId?: string,
    aggregateType?: string,
  ): Promise<OutboxEventEntity> {
    const event = this.outboxRepository.create({
      eventType,
      payload,
      aggregateId,
      aggregateType,
      published: false,
      retryCount: 0,
    });

    return this.outboxRepository.save(event);
  }

  async getUnpublishedEvents(
    limit: number = 100,
  ): Promise<OutboxEventEntity[]> {
    return this.outboxRepository.find({
      where: { published: false },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async markAsPublished(eventId: string): Promise<void> {
    await this.outboxRepository.update(eventId, {
      published: true,
      publishedAt: new Date(),
    });
  }

  async incrementRetryCount(eventId: string, error?: string): Promise<void> {
    await this.outboxRepository.increment({ id: eventId }, 'retryCount', 1);
    if (error) {
      await this.outboxRepository.update(eventId, { error });
    }
  }

  async getFailedEvents(maxRetries: number = 5): Promise<OutboxEventEntity[]> {
    return this.outboxRepository.find({
      where: {
        published: false,
        retryCount: LessThan(maxRetries),
      },
      order: { createdAt: 'ASC' },
      take: 50,
    });
  }

  async deletePublishedEvents(olderThanDays: number = 7): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.outboxRepository.delete({
      published: true,
      publishedAt: LessThan(cutoffDate),
    });

    return result.affected || 0;
  }
}
