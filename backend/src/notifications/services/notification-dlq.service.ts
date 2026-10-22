import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';

import {
  NotificationDlqEntity,
  DlqEntryStatus,
} from '../entities/notification-dlq.entity';
import { NotificationEntity } from '../entities/notification.entity';
import { NotificationStatus } from '../enums/notification-status.enum';
import { ProviderAttemptResult } from '../providers/provider-failover.service';
import { NotificationJobData } from '../processors/notification.processor';

export interface DlqReplayResult {
  dlqId: string;
  notificationId: string;
  jobId: string;
  replayedAt: string;
}

@Injectable()
export class NotificationDlqService {
  private readonly logger = new Logger(NotificationDlqService.name);

  constructor(
    @InjectRepository(NotificationDlqEntity)
    private readonly dlqRepo: Repository<NotificationDlqEntity>,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    @InjectQueue('notifications')
    private readonly notificationsQueue: Queue,
  ) {}

  /**
   * Move a definitively-failed notification into the DLQ.
   * Called by the processor after all BullMQ retries are exhausted.
   */
  async enqueue(
    notification: NotificationEntity,
    providerAttempts: ProviderAttemptResult[],
    lastError: string,
  ): Promise<NotificationDlqEntity> {
    const existing = await this.dlqRepo.findOne({
      where: {
        notificationId: notification.id,
        status: DlqEntryStatus.PENDING,
      },
    });

    if (existing) {
      this.logger.warn(
        `[DLQ] Notification ${notification.id} already in DLQ (id=${existing.id}), skipping duplicate`,
      );
      return existing;
    }

    const entry = this.dlqRepo.create({
      notificationId: notification.id,
      recipientId: notification.recipientId,
      channel: notification.channel,
      templateKey: notification.templateKey,
      variables: notification.variables ?? null,
      renderedBody: notification.renderedBody ?? '',
      providerAttempts,
      lastError,
      status: DlqEntryStatus.PENDING,
    });

    const saved = await this.dlqRepo.save(entry);

    // Mark the notification entity as DLQ
    await this.notificationRepo.update(notification.id, {
      status: NotificationStatus.DLQ,
      deliveryError: lastError,
    });

    this.logger.warn(
      `[DLQ] Notification ${notification.id} moved to DLQ (dlqId=${saved.id})`,
    );
    return saved;
  }

  /**
   * Replay a single DLQ entry — re-enqueues the job with fresh attempts.
   */
  async replay(dlqId: string, actor: string): Promise<DlqReplayResult> {
    const entry = await this.dlqRepo.findOne({ where: { id: dlqId } });
    if (!entry) throw new NotFoundException(`DLQ entry ${dlqId} not found`);

    if (entry.status === DlqEntryStatus.ABANDONED) {
      throw new BadRequestException(
        `DLQ entry ${dlqId} has been abandoned and cannot be replayed`,
      );
    }

    if (entry.status === DlqEntryStatus.REPLAYING) {
      throw new BadRequestException(
        `DLQ entry ${dlqId} is already being replayed`,
      );
    }

    // Reset the notification status to PENDING so the processor re-processes it
    await this.notificationRepo.update(entry.notificationId, {
      status: NotificationStatus.PENDING,
      deliveryError: null,
    });

    entry.status = DlqEntryStatus.REPLAYING;
    entry.replayCount += 1;
    entry.replayedBy = actor;
    entry.replayedAt = new Date();
    await this.dlqRepo.save(entry);

    const jobData: NotificationJobData = {
      notificationId: entry.notificationId,
      recipientId: entry.recipientId,
      channel: entry.channel,
      renderedBody: entry.renderedBody,
      templateKey: entry.templateKey,
      variables: entry.variables ?? undefined,
      dlqReplay: true,
      dlqId: entry.id,
    };

    const job = await this.notificationsQueue.add('sendNotification', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      jobId: `dlq-replay:${entry.id}:${entry.replayCount}`,
    });

    this.logger.log(
      `[DLQ] Replayed dlqId=${dlqId} as jobId=${job.id} by actor=${actor}`,
    );

    return {
      dlqId: entry.id,
      notificationId: entry.notificationId,
      jobId: String(job.id),
      replayedAt: entry.replayedAt!.toISOString(),
    };
  }

  /**
   * Bulk replay all PENDING DLQ entries for a given channel (or all channels).
   */
  async replayBulk(
    actor: string,
    channel?: string,
  ): Promise<{
    replayed: number;
    skipped: number;
    results: DlqReplayResult[];
  }> {
    const where: Record<string, any> = { status: DlqEntryStatus.PENDING };
    if (channel) where.channel = channel;

    const entries = await this.dlqRepo.find({ where, take: 100 });
    const results: DlqReplayResult[] = [];
    let skipped = 0;

    for (const entry of entries) {
      try {
        const result = await this.replay(entry.id, actor);
        results.push(result);
      } catch {
        skipped++;
      }
    }

    return { replayed: results.length, skipped, results };
  }

  /**
   * Mark a DLQ entry as abandoned (no further replay attempts).
   */
  async abandon(
    dlqId: string,
    reason: string,
    actor: string,
  ): Promise<NotificationDlqEntity> {
    const entry = await this.dlqRepo.findOne({ where: { id: dlqId } });
    if (!entry) throw new NotFoundException(`DLQ entry ${dlqId} not found`);

    entry.status = DlqEntryStatus.ABANDONED;
    entry.abandonReason = `[${actor}] ${reason}`;
    return this.dlqRepo.save(entry);
  }

  async list(
    status?: DlqEntryStatus,
    limit = 50,
  ): Promise<NotificationDlqEntity[]> {
    const where: Record<string, any> = {};
    if (status) where.status = status;
    return this.dlqRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async get(dlqId: string): Promise<NotificationDlqEntity> {
    const entry = await this.dlqRepo.findOne({ where: { id: dlqId } });
    if (!entry) throw new NotFoundException(`DLQ entry ${dlqId} not found`);
    return entry;
  }

  /** Called by the processor when a replayed job succeeds */
  async markReplayed(dlqId: string): Promise<void> {
    await this.dlqRepo.update(dlqId, { status: DlqEntryStatus.REPLAYED });
  }

  /** Called by the processor when a replayed job fails again */
  async markReplayFailed(dlqId: string, error: string): Promise<void> {
    await this.dlqRepo.update(dlqId, {
      status: DlqEntryStatus.PENDING,
      lastError: error,
    });
  }
}
