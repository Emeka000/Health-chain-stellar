import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ApprovalModule } from '../approvals/approval.module';
import { EventsModule } from '../events/events.module';
import { FeePolicyModule } from '../fee-policy/fee-policy.module';
import { InventoryModule } from '../inventory/inventory.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SlaModule } from '../sla/sla.module';
import { BlockchainEvent } from '../soroban/entities/blockchain-event.entity';
import { UserActivityModule } from '../user-activity/user-activity.module';

import { OrderEventEntity } from './entities/order-event.entity';
import { OrderEntity } from './entities/order.entity';
import { OrdersGateway } from './gateways/orders.gateway';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { DisputePolicyService } from './services/dispute-policy.service';
import { OrderEventStoreService } from './services/order-event-store.service';
import { OrderFeeService } from './services/order-fee.service';
import { OrderStateAuditService } from './services/order-state-audit.service';
import { RequestStatusService } from './services/request-status.service';
import { OrderStateMachine } from './state-machine/order-state-machine';

@Module({
  imports: [
    TypeOrmModule.forFeature([OrderEntity, OrderEventEntity, BlockchainEvent]),
    ConfigModule,
    JwtModule.register({}),
    InventoryModule,
    NotificationsModule,
    FeePolicyModule,
    ApprovalModule,
    SlaModule,
    EventsModule,
    UserActivityModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderStateMachine,
    DisputePolicyService,
    OrderEventStoreService,
    OrderFeeService,
    RequestStatusService,
    OrdersGateway,
    OrderStateAuditService,
  ],
  exports: [OrdersService, OrderStateMachine, OrderEventStoreService, OrderStateAuditService],
})
export class OrdersModule {}
