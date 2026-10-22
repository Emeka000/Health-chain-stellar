import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotificationPreference,
  NotificationChannel,
  NotificationCategory,
  EmergencyTier,
} from '../entities/notification-preference.entity';
import {
  NotificationDeliveryLog,
  DeliveryStatus,
} from '../entities/notification-delivery-log.entity';
import { NotificationFanoutAttemptEntity } from '../entities/notification-fanout-attempt.entity';

export interface FanoutRequest {
  userId: string;
  category: NotificationCategory;
  emergencyTier?: EmergencyTier;
  payload: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface FanoutResult {
  userId: string;
  category: NotificationCategory;
  dispatched: { channel: NotificationChannel; status: DeliveryStatus; reason?: string }[];
  criticalOverride: boolean;
}

/** Cooldown windows per category in seconds */
const COOLDOWN_SECONDS: Partial<Record<NotificationCategory, number>> = {
  [NotificationCategory.DELIVERY_UPDATE]: 60,
  [NotificationCategory.RIDER_ASSIGNMENT]: 30,
  [NotificationCategory.SETTLEMENT]: 300,
  [NotificationCategory.DISPUTE]: 120,
  [NotificationCategory.SYSTEM_ALERT]: 600,
};

/** Categories that bypass all cooldowns and dedup when tier is CRITICAL */
const CRITICAL_OVERRIDE_CATEGORIES = new Set<NotificationCategory>([
  NotificationCategory.CRITICAL_SHORTAGE,
  NotificationCategory.EMERGENCY,
]);

@Injectable()
export class NotificationFanoutService {
  private readonly logger = new Logger(NotificationFanoutService.name);

  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepo: Repository<NotificationPreference>,
    @InjectRepository(NotificationDeliveryLog)
    private readonly deliveryLogRepo: Repository<NotificationDeliveryLog>,
    @InjectRepository(NotificationFanoutAttemptEntity)
    private readonly attemptRepo: Repository<NotificationFanoutAttemptEntity>,
  ) {}

  async fanout(request: FanoutRequest): Promise<FanoutResult> {
    const { userId, category, emergencyTier = EmergencyTier.NORMAL, payload, idempotencyKey } = request;

    // Idempotency: skip if already processed
    if (idempotencyKey) {
      const existing = await this.attemptRepo.findOne({ where: { idempotencyKey } });
      if (existing) {
        this.logger.debug(`Fanout skipped (duplicate idempotency key): ${idempotencyKey}`);
        return { userId, category, dispatched: [], criticalOverride: false };
      }
    }

    const isCriticalOverride =
      emergencyTier === EmergencyTier.CRITICAL &&
      CRITICAL_OVERRIDE_CATEGORIES.has(category);

    const preference = await this.preferenceRepo.findOne({ where: { userId, category } });
    const channels: NotificationChannel[] = preference?.enabled
      ? preference.channels
      : isCriticalOverride
        ? [NotificationChannel.SMS, NotificationChannel.PUSH]
        : [];

    const dispatched: FanoutResult['dispatched'] = [];

    for (const channel of channels) {
      const result = await this.dispatchToChannel(
        userId,
        category,
        channel,
        emergencyTier,
        isCriticalOverride,
        payload,
      );
      dispatched.push(result);
    }

    // Record fanout attempt for idempotency tracking
    if (idempotencyKey) {
      await this.attemptRepo.save(
        this.attemptRepo.create({
          idempotencyKey,
          userId,
          category,
          emergencyTier,
          channelCount: dispatched.length,
        }),
      );
    }

    return { userId, category, dispatched, criticalOverride: isCriticalOverride };
  }

  private async dispatchToChannel(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
    emergencyTier: EmergencyTier,
    criticalOverride: boolean,
    _payload: Record<string, unknown>,
  ): Promise<{ channel: NotificationChannel; status: DeliveryStatus; reason?: string }> {
    // Check cooldown (skip for critical overrides)
    if (!criticalOverride) {
      const inCooldown = await this.isInCooldown(userId, category, channel);
      if (inCooldown) {
        await this.logDelivery(userId, category, channel, DeliveryStatus.SKIPPED, 'cooldown', false);
        return { channel, status: DeliveryStatus.SKIPPED, reason: 'cooldown' };
      }

      // Per-channel deduplication: skip if identical event sent recently
      const isDuplicate = await this.isDuplicate(userId, category, channel);
      if (isDuplicate) {
        await this.logDelivery(userId, category, channel, DeliveryStatus.SKIPPED, 'duplicate', false);
        return { channel, status: DeliveryStatus.SKIPPED, reason: 'duplicate' };
      }
    }

    // Dispatch (actual provider call is handled by the processor/provider layer)
    await this.logDelivery(
      userId,
      category,
      channel,
      DeliveryStatus.SENT,
      undefined,
      criticalOverride,
    );

    this.logger.log(
      `Fanout dispatched: user=${userId} category=${category} channel=${channel} tier=${emergencyTier}`,
    );

    return { channel, status: DeliveryStatus.SENT };
  }

  private async isInCooldown(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
  ): Promise<boolean> {
    const cooldownSec = COOLDOWN_SECONDS[category];
    if (!cooldownSec) return false;

    const since = new Date(Date.now() - cooldownSec * 1000);
    const count = await this.deliveryLogRepo.count({
      where: { userId, category, channel, status: DeliveryStatus.SENT },
    });

    if (count === 0) return false;

    // Check if last sent is within cooldown window
    const last = await this.deliveryLogRepo.findOne({
      where: { userId, category, channel, status: DeliveryStatus.SENT },
      order: { createdAt: 'DESC' },
    });

    return last ? last.createdAt > since : false;
  }

  private async isDuplicate(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
  ): Promise<boolean> {
    // Dedup window: 10 seconds
    const since = new Date(Date.now() - 10_000);
    const last = await this.deliveryLogRepo.findOne({
      where: { userId, category, channel },
      order: { createdAt: 'DESC' },
    });
    return last ? last.createdAt > since : false;
  }

  private async logDelivery(
    userId: string,
    category: NotificationCategory,
    channel: NotificationChannel,
    status: DeliveryStatus,
    reason?: string,
    emergencyBypass = false,
  ): Promise<void> {
    await this.deliveryLogRepo.save(
      this.deliveryLogRepo.create({ userId, category, channel, status, reason, emergencyBypass }),
    );
  }
}
