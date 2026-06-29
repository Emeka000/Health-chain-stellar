import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Queue, QueueEvents } from 'bullmq';

import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';
import { NotificationsService } from '../../notifications/notifications.service';

const DONOR_OUTREACH_QUEUE = 'donor-outreach';

@Injectable()
export class DonorOutreachQueueEventsListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DonorOutreachQueueEventsListener.name);
  private queueEvents: QueueEvents | null = null;

  constructor(
    @InjectQueue(DONOR_OUTREACH_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.queueEvents = new QueueEvents(DONOR_OUTREACH_QUEUE, {
      connection: {
        host: this.configService.get<string>('REDIS_HOST', 'localhost'),
        port: this.configService.get<number>('REDIS_PORT', 6379),
      },
    });

    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      void this.handlePermanentFailure(jobId, failedReason);
    });

    this.logger.log('Donor outreach queue failure listener attached');
  }

  async onModuleDestroy(): Promise<void> {
    await this.queueEvents?.close();
  }

  private async handlePermanentFailure(
    jobId: string,
    failedReason: string,
  ): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (!job) return;

    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      return;
    }

    const data = job.data as Record<string, unknown>;
    this.logger.error(
      `[DLQ] Donor outreach job ${jobId} permanently failed: ${failedReason}`,
    );

    try {
      await this.notificationsService.send({
        recipientId: 'ops-team',
        channels: [NotificationChannel.IN_APP],
        templateKey: 'donor_outreach_job_failed',
        variables: {
          jobId,
          bloodType: data.bloodType,
          region: data.region,
          failedReason,
          attemptsMade: job.attemptsMade,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify ops for donor outreach job ${jobId}: ${(err as Error).message}`,
      );
    }
  }
}
