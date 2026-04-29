import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';
import { RequestUrgency } from '../enums/request-urgency.enum';
import { EscalationService } from '../../escalation/escalation.service';
import { BloodRequestEntity } from '../entities/blood-request.entity';

export interface SlaBreachedPayload {
  requestId: string;
  urgency: RequestUrgency;
  enqueuedAt: number;
  breachedAt: number;
  elapsedMs: number;
  slaWindowMs: number;
}

@Injectable()
export class SlaBreachListener {
  private readonly logger = new Logger(SlaBreachListener.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly escalationService: EscalationService,
    @InjectRepository(BloodRequestEntity)
    private readonly bloodRequestRepo: Repository<BloodRequestEntity>,
  ) {}

  @OnEvent('blood-request.sla-breached', { async: true })
  async handleSlaBreached(payload: SlaBreachedPayload): Promise<void> {
    this.logger.warn(
      `[SLA BREACH] Request ${payload.requestId} [${payload.urgency}] exceeded SLA by ${Math.round((payload.elapsedMs - payload.slaWindowMs) / 1000)}s`,
    );

    try {
      const request = await this.bloodRequestRepo.findOne({
        where: { id: payload.requestId },
      });
      // Alert the operator channel — recipientId 'ops-team' is a broadcast target
      await this.notificationsService.send({
        recipientId: 'ops-team',
        channels: [NotificationChannel.IN_APP],
        templateKey: 'blood_request_sla_breached',
        variables: {
          requestId: payload.requestId,
          urgency: payload.urgency,
          elapsedMinutes: Math.round(payload.elapsedMs / 60_000),
          slaMinutes: Math.round(payload.slaWindowMs / 60_000),
          breachedAt: new Date(payload.breachedAt).toISOString(),
        },
      });

      if (request) {
        await this.escalationService.evaluate(
          payload.requestId,
          null,
          request.hospitalId,
          null,
          {
            urgency: payload.urgency,
            inventoryUnits: 0,
            requiredUnits: 1,
            timeRemainingSeconds: -1,
          },
        );
      }
    } catch (err) {
      this.logger.error(
        `Failed to send SLA breach notification for ${payload.requestId}: ${(err as Error).message}`,
      );
    }
  }
}
