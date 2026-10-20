import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrdersService } from '../orders/orders.service';
import { User } from '../users/entities/user.entity';
import { TenantActorContext } from '../common/interfaces/tenant-actor-context.interface';
import { CreateOrderDto } from '../orders/dto/create-order.dto';
import { OrderChannel, UrgencyTier, ServiceLevel } from '../orders/enums';
import { UssdSession } from './entities/ussd-session.entity';
import { UssdSessionState } from './enums/ussd-session-state.enum';

@Injectable()
export class UssdSessionService {
  private readonly logger = new Logger(UssdSessionService.name);

  constructor(
    @InjectRepository(UssdSession)
    private readonly sessionRepository: Repository<UssdSession>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly ordersService: OrdersService,
  ) {}

  async handleInput(session: UssdSession, input: string): Promise<string> {
    switch (session.state) {
      case UssdSessionState.AWAITING_BLOOD_TYPE:
        return this.handleBloodType(session, input);
      case UssdSessionState.AWAITING_QUANTITY:
        return this.handleQuantity(session, input);
      case UssdSessionState.AWAITING_BLOOD_BANK:
        return this.handleBloodBank(session, input);
      default:
        return 'Invalid session state. Please dial again.';
    }
  }

  private async handleBloodType(session: UssdSession, input: string): Promise<string> {
    const bloodType = input.trim().toUpperCase();
    const valid = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    if (!valid.includes(bloodType)) {
      return 'Invalid blood type. Please enter a valid blood type (e.g. O+):';
    }
    session.data = { ...session.data, bloodType };
    session.state = UssdSessionState.AWAITING_QUANTITY;
    await this.sessionRepository.save(session);
    return 'Enter the number of units required:';
  }

  private async handleQuantity(session: UssdSession, input: string): Promise<string> {
    const quantity = parseInt(input.trim(), 10);
    if (isNaN(quantity) || quantity <= 0) {
      return 'Invalid quantity. Please enter a positive number of units:';
    }
    session.data = { ...session.data, quantity };
    session.state = UssdSessionState.AWAITING_BLOOD_BANK;
    await this.sessionRepository.save(session);
    return 'Enter the blood bank ID to order from:';
  }

  private async handleBloodBank(session: UssdSession, input: string): Promise<string> {
    const bloodBankId = input.trim();
    if (!bloodBankId) {
      return 'Invalid blood bank ID. Please enter the blood bank ID:';
    }

    const user = await this.userRepository.findById(session.userId);
    if (!user) {
      throw new NotFoundException('User not found for USSD session');
    }
    if (!user.organizationId) {
      throw new ForbiddenException('Caller is not associated with an organization');
    }

    const actor: TenantActorContext = {
      userId: user.id,
      role: user.role,
      organizationId: user.organizationId,
    };

    const dto: CreateOrderDto = {
      bloodType: session.data.bloodType,
      quantity: session.data.quantity,
      bloodBankId,
      hospitalId: user.organizationId,
      deliveryAddress: user.deliveryAddress ?? user.organizationId,
      geographyCode: user.geographyCode ?? 'USSD',
      urgencyTier: UrgencyTier.STANDARD,
      estimatedDistanceKm: 0,
      serviceLevel: ServiceLevel.STANDARD,
      channel: OrderChannel.USSD,
    };

    const order = await this.ordersService.create(dto, user.id, actor);

    session.data = { ...session.data, bloodBankId, orderId: order.id };
    session.state = UssdSessionState.COMPLETED;
    await this.sessionRepository.save(session);

    this.logger.log(`USSD order ${order.id} created for user ${user.id}`);
    return `Order placed successfully. Reference: ${order.id}`;
  }
}
