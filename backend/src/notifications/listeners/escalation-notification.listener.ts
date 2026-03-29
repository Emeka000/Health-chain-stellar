import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { EscalationTriggeredEvent } from '../../events/escalation-triggered.event';
import { NotificationsService } from '../notifications.service';
import { NotificationChannel } from '../enums/notification-channel.enum';

@Injectable()
export class EscalationNotificationListener {
  private readonly logger = new Logger(EscalationNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent('escalation.triggered')
  async handleEscalationTriggered(event: EscalationTriggeredEvent): Promise<void> {
    this.logger.log(`Escalation notification tier=${event.tier} request=${event.requestId}`);

    const channels =
      event.tier === 'TIER_3'
        ? [NotificationChannel.SMS, NotificationChannel.PUSH, NotificationChannel.IN_APP]
        : [NotificationChannel.PUSH, NotificationChannel.IN_APP];

    try {
      await this.notificationsService.send({
        recipientId: event.hospitalId,
        channels,
        templateKey: 'escalation.triggered',
        variables: {
          requestId: event.requestId,
          tier: event.tier,
          slaDeadlineMs: String(event.slaDeadlineMs),
        },
      });

      if (event.riderId) {
        await this.notificationsService.send({
          recipientId: event.riderId,
          channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
          templateKey: 'escalation.triggered',
          variables: {
            requestId: event.requestId,
            tier: event.tier,
            slaDeadlineMs: String(event.slaDeadlineMs),
          },
        });
      }
    } catch (error) {
      this.logger.error(`Failed to send escalation notification: ${error.message}`, error.stack);
    }
  }
}
