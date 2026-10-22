import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { NotificationEntity } from '../entities/notification.entity';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationStatus } from '../enums/notification-status.enum';
import { ProviderFailoverService } from '../providers/provider-failover.service';
import { NotificationDlqService } from '../services/notification-dlq.service';

export interface NotificationJobData {
  notificationId: string;
  recipientId: string;
  channel: NotificationChannel;
  renderedBody: string;
  templateKey?: string;
  variables?: Record<string, any>;
  /** Set when this job was triggered by a DLQ replay */
  dlqReplay?: boolean;
  dlqId?: string;
  /** Set when this job was triggered by the delivery repair cron */
  repairRun?: boolean;
}

@Processor('notifications', { concurrency: 5 })
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    private readonly failoverService: ProviderFailoverService,
    private readonly dlqService: NotificationDlqService,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<any> {
    const { notificationId, channel, recipientId, renderedBody, variables } =
      job.data;
    const idempotencyKey = `${notificationId}:${channel}`;

    this.logger.log(
      `Processing notification job ${job.id} [${channel}] -> ${recipientId}` +
        (job.data.dlqReplay ? ' [DLQ-REPLAY]' : '') +
        (job.data.repairRun ? ' [REPAIR]' : ''),
    );

    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });

    if (!notification) {
      this.logger.warn(`Notification ${notificationId} not found — skipping`);
      return { status: 'not_found', notificationId };
    }

    if (notification.status === NotificationStatus.SENT) {
      this.logger.warn(
        `Skipping duplicate send for ${idempotencyKey} (already SENT)`,
      );
      return { status: 'already_sent', notificationId };
    }

    // Deliver via failover chain
    const result = await this.failoverService.deliver(
      channel,
      recipientId,
      renderedBody,
      variables,
    );

    if (result.delivered) {
      await this.notificationRepo.update(notification.id, {
        status: NotificationStatus.SENT,
        deliveryError: null,
      });

      // If this was a DLQ replay, mark it resolved
      if (job.data.dlqReplay && job.data.dlqId) {
        await this.dlqService.markReplayed(job.data.dlqId);
      }

      return {
        status: 'sent',
        notificationId,
        provider: result.finalProvider,
        attempts: result.attempts.length,
      };
    }

    // All providers failed — throw so BullMQ retries
    const lastError = result.attempts.at(-1)?.error ?? 'All providers failed';
    this.logger.error(
      `All providers failed for job ${job.id} [${channel}]: ${lastError}`,
    );
    throw new Error(lastError);
  }

  /**
   * Called by BullMQ after all retry attempts are exhausted.
   * Moves the notification to the DLQ.
   */
  async onFailed(job: Job<NotificationJobData>, error: Error): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return; // still has retries left

    this.logger.error(
      `Job ${job.id} definitively failed after ${job.attemptsMade} attempts: ${error.message}`,
    );

    const { notificationId, channel } = job.data;

    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });

    if (!notification) return;

    // Re-run failover to capture the final attempt log for DLQ metadata
    const finalAttemptResult = await this.failoverService.deliver(
      channel,
      notification.recipientId,
      notification.renderedBody ?? '',
      job.data.variables,
    );

    if (job.data.dlqReplay && job.data.dlqId) {
      // Replay itself failed — reset DLQ entry to PENDING for manual retry
      await this.dlqService.markReplayFailed(job.data.dlqId, error.message);
    } else {
      // First-time failure — move to DLQ
      await this.dlqService.enqueue(
        notification,
        finalAttemptResult.attempts,
        error.message,
      );
    }
  }
}
