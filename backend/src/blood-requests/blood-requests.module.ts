import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { CompensationModule } from '../common/compensation/compensation.module';
import { EscalationModule } from '../escalation/escalation.module';
import { InventoryStockEntity } from '../inventory/entities/inventory-stock.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { MapsModule } from '../maps/maps.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationEntity } from '../organizations/entities/organization.entity';
import { DispatchRecord } from '../dispatch/entities/dispatch-record.entity';
import { RiderEntity } from '../riders/entities/rider.entity';
import { OrderEntity } from '../orders/entities/order.entity';

import { BloodRequestsController } from './blood-requests.controller';
import { BloodRequestsService } from './blood-requests.service';
import { OrderSplittingController } from './controllers/order-splitting.controller';
import { RequestQueryController } from './controllers/request-query.controller';
import { BloodRequestItemEntity } from './entities/blood-request-item.entity';
import { BloodRequestReservationEntity } from './entities/blood-request-reservation.entity';
import { BloodRequestSagaEntity } from './entities/blood-request-saga.entity';
import { BloodRequestEntity } from './entities/blood-request.entity';
import { FulfillmentLegEntity } from './entities/fulfillment-leg.entity';
import { RequestStatusHistoryEntity } from './entities/request-status-history.entity';
import { BLOOD_REQUEST_QUEUE } from './enums/request-urgency.enum';
import { SlaBreachListener } from './listeners/sla-breach.listener';
import { BloodRequestProcessor } from './processors/blood-request.processor';
import { BloodBankAvailabilityService } from './services/blood-bank-availability.service';
import { BloodRequestChainService } from './services/blood-request-chain.service';
import { BloodRequestEmailService } from './services/blood-request-email.service';
import { BloodRequestReservationService } from './services/blood-request-reservation.service';
import { RequestQueryService } from './services/request-query.service';
import { SagaCoordinatorService } from './services/saga-coordinator.service';
import { TriageScoringService } from './services/triage-scoring.service';
import { OrderSplittingService } from './services/order-splitting.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BloodRequestEntity,
      BloodRequestItemEntity,
      BloodRequestReservationEntity,
      BloodRequestSagaEntity,
      RequestStatusHistoryEntity,
      FulfillmentLegEntity,
      InventoryStockEntity,
      OrganizationEntity,
      DispatchRecord,
      RiderEntity,
      OrderEntity,
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
    AuthModule,
    InventoryModule,
    BlockchainModule,
    NotificationsModule,
    CompensationModule,
    MapsModule,
    EscalationModule,
  ],
  controllers: [
    BloodRequestsController,
    RequestQueryController,
    OrderSplittingController,
  ],
  providers: [
    BloodRequestsService,
    BloodRequestChainService,
    BloodRequestEmailService,
    BloodRequestProcessor,
    SlaBreachListener,
    RequestQueryService,
    BloodBankAvailabilityService,
    BloodRequestReservationService,
    OrderSplittingService,
    TriageScoringService,
    SagaCoordinatorService,
  ],
  exports: [
    BloodRequestsService,
    RequestQueryService,
    BloodBankAvailabilityService,
    BloodRequestReservationService,
    TriageScoringService,
    SagaCoordinatorService,
  ],
})
export class BloodRequestsModule {}
