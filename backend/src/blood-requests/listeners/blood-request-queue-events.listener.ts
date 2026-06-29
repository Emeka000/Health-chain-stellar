import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue, QueueEvents } from 'bullmq';
import { Repository } from 'typeorm';

import { EscalationService } from '../../escalation/escalation.service';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';
import { NotificationsService } from '../../notifications/notifications.service';
import { BloodRequestEntity } from '../entities/blood-request.entity';
import { BLOOD_REQUEST_QUEUE } from '../enums/request-urgency.enum';
import { BloodRequestJobData } from '../processors/blood-request.processor';

@Injectable()
export class BloodRequestQueueEventsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BloodRequestQueueEventsListener.name);
  private queueEvents: QueueEvents | null = null;

  constructor(
    @InjectQueue(BLOOD_REQUEST_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly escalationService: EscalationService,
    @InjectRepository(BloodRequestEntity)
    private readonly bloodRequestRepo: Repository<BloodRequestEntity>,
  ) {}

  onModuleInit(): void {
    this.queueEvents = new QueueEvents(BLOOD_REQUEST_QUEUE, {
      connection: {
        host: this.configService.get<string>('REDIS_HOST', 'localhost'),
        port: this.configService.get<number>('REDIS_PORT', 6379),
      },
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      void this.handlePermanentFailure(jobId, failedReason);
    });

    this.logger.log('Blood request queue failure listener attached');
  }

  async onModuleDestroy(): Promise<void> {
    await this.queueEvents?.close();
  }

  private async handlePermanentFailure(
    jobId: string,
    failedReason: string,
  ): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) {
      this.logger.warn(`Failed job ${jobId} not found in queue`);
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      return;
    }

    const data = job.data as BloodRequestJobData;
    this.logger.error(
      `[DLQ] Blood request job ${jobId} permanently failed for request ${data.requestId}: ${failedReason}`,
    );

    try {
      await this.notificationsService.send({
        recipientId: 'ops-team',
        channels: [NotificationChannel.IN_APP],
        templateKey: 'blood_request_job_failed',
        variables: {
          requestId: data.requestId,
          urgency: data.urgency,
          jobId,
          failedReason,
          attemptsMade: job.attemptsMade,
        },
      });

      const request = await this.bloodRequestRepo.findOne({
        where: { id: data.requestId },
      });

      if (request) {
        await this.escalationService.evaluate(
          data.requestId,
          null,
          request.hospitalId,
          null,
          {
            urgency: data.urgency,
            inventoryUnits: 0,
            requiredUnits: 1,
            timeRemainingSeconds: -1,
          },
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to escalate permanently failed blood request job ${jobId}: ${(err as Error).message}`,
      );
    }
  }
}
