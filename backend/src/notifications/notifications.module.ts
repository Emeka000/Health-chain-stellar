import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PolicyCenterModule } from '../policy-center/policy-center.module';

import { NotificationTemplateEntity } from './entities/notification-template.entity';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationDeliveryLog } from './entities/notification-delivery-log.entity';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { OrderNotificationListener } from './listeners/order-notification.listener';
import { EscalationNotificationListener } from './listeners/escalation-notification.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationPreferenceController } from './controllers/notification-preference.controller';
import { NotificationsService } from './notifications.service';
import { NotificationPreferenceService } from './services/notification-preference.service';
import { NotificationProcessor } from './processors/notification.processor';
import { EmailProvider } from './providers/email.provider';
import { InAppProvider } from './providers/in-app.provider';
import { PushProvider } from './providers/push.provider';
import { SmsProvider } from './providers/sms.provider';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationEntity,
      NotificationTemplateEntity,
      NotificationPreference,
      NotificationDeliveryLog,
    ]),
    BullModule.registerQueue({
      name: 'notifications',
    }),
    EventEmitterModule.forRoot(),
    PolicyCenterModule,
  ],
  controllers: [NotificationsController, NotificationPreferenceController],
  providers: [
    // Providers
    SmsProvider,
    PushProvider,
    EmailProvider,
    InAppProvider,

    // Gateways
    NotificationsGateway,

    // Processors
    NotificationProcessor,

    // Listeners
    OrderNotificationListener,
    EscalationNotificationListener,

    // Services
    NotificationsService,
    NotificationPreferenceService,
  ],
  exports: [NotificationsService, NotificationPreferenceService, EmailProvider],
})
export class NotificationsModule {}
