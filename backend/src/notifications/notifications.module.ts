import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PolicyCenterModule } from '../policy-center/policy-center.module';
import { UserActivityModule } from '../user-activity/user-activity.module';

import { NotificationTemplateEntity } from './entities/notification-template.entity';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationPreference } from './entities/notification-preference.entity';
import { NotificationDeliveryLog } from './entities/notification-delivery-log.entity';
import { NotificationDlqEntity } from './entities/notification-dlq.entity';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { OrderNotificationListener } from './listeners/order-notification.listener';
import { EscalationNotificationListener } from './listeners/escalation-notification.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationPreferenceController } from './controllers/notification-preference.controller';
import { NotificationDlqController } from './controllers/notification-dlq.controller';
import { NotificationsService } from './notifications.service';
import { NotificationPreferenceService } from './services/notification-preference.service';
import { NotificationDlqService } from './services/notification-dlq.service';
import { DeliveryRepairService } from './services/delivery-repair.service';
import { NotificationProcessor } from './processors/notification.processor';
import { EmailProvider } from './providers/email.provider';
import { InAppProvider } from './providers/in-app.provider';
import { PushProvider } from './providers/push.provider';
import { SmsProvider } from './providers/sms.provider';
import { ProviderFailoverService } from './providers/provider-failover.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      NotificationEntity,
      NotificationTemplateEntity,
      NotificationPreference,
      NotificationDeliveryLog,
      NotificationDlqEntity,
    ]),
    BullModule.registerQueue({
      name: 'notifications',
    }),
    ScheduleModule.forRoot(),
    PolicyCenterModule,
    UserActivityModule,
  ],
  controllers: [
    NotificationsController,
    NotificationPreferenceController,
    NotificationDlqController,
  ],
  providers: [
    // Transport providers
    SmsProvider,
    PushProvider,
    EmailProvider,
    InAppProvider,

    // Failover orchestration
    ProviderFailoverService,

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
    NotificationDlqService,
    DeliveryRepairService,
  ],
  exports: [
    NotificationsService,
    NotificationPreferenceService,
    NotificationDlqService,
    EmailProvider,
  ],
})
export class NotificationsModule {}
