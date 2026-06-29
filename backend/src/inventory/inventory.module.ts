import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BloodRequestEntity } from '../blood-requests/entities/blood-request.entity';
import { BloodRequestReservationEntity } from '../blood-requests/entities/blood-request-reservation.entity';
import { DonationEntity } from '../donations/entities/donation.entity';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrderEntity } from '../orders/entities/order.entity';
import { UsersModule } from '../users/users.module';
import { InventoryStockRepository } from './repositories/inventory-stock.repository';
import { OrganizationEntity } from '../organizations/entities/organization.entity';


import { InventoryAlertController } from './controllers/inventory-alert.controller';
import { ExpirationForecastingController } from './controllers/expiration-forecasting.controller';
import { InventoryAnalyticsController } from './controllers/inventory-analytics.controller';
import { RestockingCampaignController } from './controllers/restocking-campaign.controller';
import { AlertPreferenceEntity } from './entities/alert-preference.entity';
import { InventoryAlertEntity } from './entities/inventory-alert.entity';
import { InventoryEntity } from './entities/inventory.entity';
import { InventoryStockEntity } from './entities/inventory-stock.entity';
import { ReservationAuditEntity } from './entities/reservation-audit.entity';
import { RestockingCampaignEntity } from './entities/restocking-campaign.entity';
import { ExpirationForecastingService } from './expiration-forecasting.service';
import { InventoryAnalyticsService } from './inventory-analytics.service';
import { InventoryEventListener } from './inventory-event.listener';
import { InventoryForecastingService } from './inventory-forecasting.service';
import { InventoryController } from './inventory.controller';
import { InventoryRepository } from './repositories/inventory.repository';
import { InventoryService } from './inventory.service';
import { DonorOutreachQueueEventsListener } from './listeners/donor-outreach-queue-events.listener';
import { DonorOutreachProcessor } from './processors/donor-outreach.processor';
import { InventoryAlertService } from './services/inventory-alert.service';
import { RestockingCampaignService } from './services/restocking-campaign.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrderEntity,
      BloodRequestEntity,
      BloodRequestReservationEntity,
      DonationEntity,
      InventoryEntity,
      InventoryStockEntity,
      InventoryAlertEntity,
      AlertPreferenceEntity,
      RestockingCampaignEntity,
      ReservationAuditEntity,
      OrganizationEntity,
      BloodUnit,
    ]),
    BullModule.registerQueueAsync({
      name: 'donor-outreach',
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      }),
      inject: [ConfigService],
    }),
    NotificationsModule,
    UsersModule,
  ],
  controllers: [
    InventoryController,
    InventoryAlertController,
    RestockingCampaignController,
    InventoryAnalyticsController,
    ExpirationForecastingController,
  ],
  providers: [
    InventoryStockRepository,
    InventoryService,
    InventoryRepository,
    InventoryForecastingService,
    InventoryAnalyticsService,
    InventoryEventListener,
    ExpirationForecastingService,
    DonorOutreachProcessor,
    DonorOutreachQueueEventsListener,
    InventoryAlertService,
    RestockingCampaignService,
  ],
  exports: [
    InventoryService,
    InventoryForecastingService,
    InventoryAlertService,
    RestockingCampaignService,
    InventoryAnalyticsService,
  ],
})
export class InventoryModule {}
