import { ForbiddenException, Module } from '@nestjs/common';

import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { RedisModule } from '../redis/redis.module';
import { UserRepository } from '../users/user.repository';
import { UsersModule } from '../users/users.module';

import { UssdAuthService } from './ussd-auth.service';
import { UssdSessionStore } from './ussd-session.store';
import { UssdStateMachine } from './ussd-state-machine.service';
import { UssdController } from './ussd.controller';
import { IOrderService, ORDER_SERVICE, UssdService } from './ussd.service';

/**
 * Adapts OrdersService to the IOrderService interface expected by UssdService.
 * OrdersService.create() maps to IOrderService.createOrder().
 */
class OrderServiceAdapter implements IOrderService {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly userRepository: UserRepository,
  ) {}

  async createOrder(params: {
    userId: string;
    bloodType: string;
    quantity: number;
    bloodBankId: string;
    channel: string;
  }): Promise<{ id: string }> {
    const user = await this.userRepository.findById(params.userId);
    if (!user) {
      throw new ForbiddenException('USSD caller is not associated with an organization');
    }

    const organizationId = user.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('USSD caller is not associated with an organization');
    }

    const actor = {
      userId: user.id,
      role: user.role,
      organizationId,
    };

    const order = await this.ordersService.create(
      {
        bloodType: params.bloodType,
        quantity: params.quantity,
        bloodBankId: params.bloodBankId,
        hospitalId: organizationId,
        deliveryAddress: user.address ?? 'USSD order',
        geographyCode: user.geographyCode ?? 'USSD',
        urgencyTier: 'standard',
        estimatedDistanceKm: 0,
        serviceLevel: 'standard',
      },
      params.userId,
      actor,
    );
    return { id: order.id };
  }
}

@Module({
  imports: [
    RedisModule,   // provides REDIS_CLIENT token for UssdSessionStore
    OrdersModule,  // provides OrdersService
    UsersModule,   // provides UserRepository for USSD PIN authentication
  ],
  controllers: [UssdController],
  providers: [
    UssdStateMachine,
    UssdSessionStore,
    UssdAuthService,
    {
      provide: ORDER_SERVICE,
      useFactory: (ordersService: OrdersService, userRepository: UserRepository) =>
        new OrderServiceAdapter(ordersService, userRepository),
      inject: [OrdersService, UserRepository],
    },
    UssdService,
  ],
  exports: [UssdService],
})
export class UssdModule {}
