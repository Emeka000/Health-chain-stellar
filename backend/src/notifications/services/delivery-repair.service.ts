import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { LessThan, Repository } from 'typeorm';

import { NotificationEntity } from '../entities/notification.entity';
import { NotificationStatus } from '../enums/notification-status.enum';
import { NotificationJobData } from '../processors/notification.processor';

/**
 * Periodically scans for notifications stuck in PENDING state
 * (i.e. the job was enqueued but the processor never updated the DB)
 * and re-enqueues them for delivery.
 */
@Injectable()
export class DeliveryRepairService {
  private readonly logger = new Logger(DeliveryRepairService.name);

  /** Notifications older than this threshold are considered stuck */
  private readonly stuckThresholdMs = 10 * 60 * 1000; // 10 minutes

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    @InjectQueue('notifications')
    private readonly notificationsQueue: Queue,
  ) {}

  /**
   * Runs every 5 minutes. Finds PENDING notifications older than the stuck
   * threshold and re-enqueues them with a repair job tag.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async repairStuckNotifications(): Promise<void> {
    const cutoff = new Date(Date.now() - this.stuckThresholdMs);

    const stuck = await this.notificationRepo.find({
      where: {
        status: NotificationStatus.PENDING,
        createdAt: LessThan(cutoff),
      },
      take: 50,
      order: { createdAt: 'ASC' },
    });

    if (stuck.length === 0) return;

    this.logger.warn(
      `[Repair] Found ${stuck.length} stuck PENDING notifications, re-enqueuing`,
    );

    for (const notification of stuck) {
      try {
        const jobData: NotificationJobData = {
          notificationId: notification.id,
          recipientId: notification.recipientId,
          channel: notification.channel,
          renderedBody: notification.renderedBody ?? '',
          templateKey: notification.templateKey,
          variables: notification.variables ?? undefined,
          repairRun: true,
        };

        await this.notificationsQueue.add('sendNotification', jobData, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 3000 },
          // Deduplicate: if a job for this notification is already queued, skip
          jobId: `repair:${notification.id}:${notification.channel}`,
        });

        this.logger.log(
          `[Repair] Re-enqueued notification ${notification.id} (${notification.channel})`,
        );
      } catch (err: any) {
        this.logger.error(
          `[Repair] Failed to re-enqueue notification ${notification.id}: ${err?.message}`,
        );
      }
    }
  }
}
