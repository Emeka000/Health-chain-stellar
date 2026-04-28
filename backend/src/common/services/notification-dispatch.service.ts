import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';

export interface DispatchPayload {
  recipientId: string;
  templateKey: string;
  variables?: Record<string, unknown>;
  channels?: NotificationChannel[];
}

/**
 * Thin, @Optional wrapper around NotificationsService.
 * Modules that need to fire-and-forget a notification import CommonModule
 * instead of the full NotificationsModule, keeping the dependency graph clean.
 */
@Injectable()
export class NotificationDispatchService {
  private readonly logger = new Logger(NotificationDispatchService.name);

  constructor(
    @Optional() private readonly notificationsService?: NotificationsService,
  ) {}

  async dispatch(payload: DispatchPayload): Promise<void> {
    if (!this.notificationsService) return;
    try {
      await this.notificationsService.send({
        recipientId: payload.recipientId,
        channels: payload.channels ?? [NotificationChannel.IN_APP],
        templateKey: payload.templateKey,
        variables: payload.variables,
      });
    } catch (err: unknown) {
      this.logger.warn(
        `Notification dispatch failed [${payload.templateKey}]: ${(err as Error).message}`,
      );
    }
  }
}
