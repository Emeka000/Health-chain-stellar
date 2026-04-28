import { Module } from '@nestjs/common';

import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { RedisModule } from '../redis/redis.module';

import { UssdSessionStore } from './ussd-session.store';
import { UssdStateMachine } from './ussd-state-machine.service';
import { UssdController } from './ussd.controller';
import { IOrderService, UssdService } from './ussd.service';

/**
 * Adapts OrdersService to the IOrderService interface expected by UssdService.
 * OrdersService.create() maps to IOrderService.createOrder().
 */
class OrderServiceAdapter implements IOrderService {
  constructor(private readonly ordersService: OrdersService) {}

  async createOrder(params: {
    userId: string;
    bloodType: string;
    quantity: number;
    bloodBankId: string;
    channel: string;
  }): Promise<{ id: string }> {
    const order = await this.ordersService.create(
      {
        bloodType: params.bloodType,
        quantity: params.quantity,
        bloodBankId: params.bloodBankId,
        channel: params.channel,
      } as any,
      params.userId,
    );
    return { id: order.id };
  }
}

@Module({
  imports: [
    RedisModule,   // provides REDIS_CLIENT token for UssdSessionStore
    OrdersModule,  // provides OrdersService
  ],
  controllers: [UssdController],
  providers: [
    UssdStateMachine,
    UssdSessionStore,
    {
      provide: IOrderService as unknown as string,
      useFactory: (ordersService: OrdersService) =>
        new OrderServiceAdapter(ordersService),
      inject: [OrdersService],
    },
    UssdService,
  ],
  exports: [UssdService],
})
export class UssdModule {}
