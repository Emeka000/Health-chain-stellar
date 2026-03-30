import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { BlockchainModule } from '../blockchain/blockchain.module';
import { CompensationModule } from '../common/compensation/compensation.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MapsModule } from '../maps/maps.module';
import { OrganizationEntity } from '../organizations/entities/organization.entity';

import { BloodRequestsController } from './blood-requests.controller';
import { BloodRequestsService } from './blood-requests.service';
import { RequestQueryController } from './controllers/request-query.controller';
import { BloodRequestItemEntity } from './entities/blood-request-item.entity';
import { BloodRequestEntity } from './entities/blood-request.entity';
import { BloodRequestReservationEntity } from './entities/blood-request-reservation.entity';
import { BLOOD_REQUEST_QUEUE } from './enums/request-urgency.enum';
import { SlaBreachListener } from './listeners/sla-breach.listener';
import { BloodRequestProcessor } from './processors/blood-request.processor';
import { RequestQueryService } from './services/request-query.service';
import { BloodBankAvailabilityService } from './services/blood-bank-availability.service';
import { BloodRequestReservationService } from './services/blood-request-reservation.service';
import { InventoryStockEntity } from '../inventory/entities/inventory-stock.entity';

import { BloodRequestChainService } from './services/blood-request-chain.service';
import { BloodRequestEmailService } from './services/blood-request-email.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BloodRequestEntity,
      BloodRequestItemEntity,
      BloodRequestReservationEntity,
      InventoryStockEntity,
      OrganizationEntity,
    ]),
    BullModule.registerQueueAsync({
      name: BLOOD_REQUEST_QUEUE,
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
    InventoryModule,
    BlockchainModule,
    NotificationsModule,
    CompensationModule,
    MapsModule,
  ],
  controllers: [BloodRequestsController, RequestQueryController],
  providers: [
    BloodRequestsService,
    BloodRequestChainService,
    BloodRequestEmailService,
    BloodRequestProcessor,
    SlaBreachListener,
    RequestQueryService,
    BloodBankAvailabilityService,
    BloodRequestReservationService,
  ],
  exports: [
    BloodRequestsService,
    RequestQueryService,
    BloodBankAvailabilityService,
    BloodRequestReservationService,
  ],
})
export class BloodRequestsModule {}
