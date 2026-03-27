import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FeePolicyModule } from '../fee-policy/fee-policy.module';
import { BlockchainEvent } from '../soroban/entities/blockchain-event.entity';

import { OrderEventEntity } from './entities/order-event.entity';

import { OrderEntity } from './entities/order.entity';
import { OrdersGateway } from './gateways/orders.gateway';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderEventStoreService } from './services/order-event-store.service';
import { RequestStatusService } from './services/request-status.service';
import { OrderStateMachine } from './state-machine/order-state-machine';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderEntity, OrderEventEntity, BlockchainEvent]),
    EventEmitterModule.forRoot(),
    InventoryModule,
    NotificationsModule,
    FeePolicyModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderStateMachine,
    OrderEventStoreService,
    RequestStatusService,
    OrdersGateway,
  ],
  exports: [OrdersService, OrderStateMachine, OrderEventStoreService],
})
export class OrdersModule { }
