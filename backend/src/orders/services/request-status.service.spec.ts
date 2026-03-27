import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { InventoryService } from '../../inventory/inventory.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { OrderEntity } from '../entities/order.entity';
import { OrderStatus } from '../enums/order-status.enum';
import { RequestStatusAction } from '../enums/request-status-action.enum';
import { OrdersGateway } from '../gateways/orders.gateway';
import { OrderStateMachine } from '../state-machine/order-state-machine';

import { OrderEventStoreService } from './order-event-store.service';
import { RequestStatusService } from './request-status.service';

describe('RequestStatusService', () => {
  let service: RequestStatusService;

  const eventStore = {
    persistEvent: jest.fn(),
  } as unknown as jest.Mocked<OrderEventStoreService>;

  const gateway = {
    emitOrderStatusUpdated: jest.fn(),
  } as unknown as jest.Mocked<OrdersGateway>;

  const eventEmitter = {
    emit: jest.fn(),
  } as unknown as jest.Mocked<EventEmitter2>;

  const inventoryService = {
    restoreStockOrThrow: jest.fn(),
    commitFulfillmentStockOrThrow: jest.fn(),
  } as unknown as jest.Mocked<InventoryService>;

  const blockchainEventRepo = {
    create: jest.fn().mockImplementation((input) => input),
    save: jest.fn(),
  } as any;

  const notificationsService = {
    send: jest.fn(),
  } as unknown as jest.Mocked<NotificationsService>;

  const createOrder = (status: OrderStatus): OrderEntity =>
    ({
      id: 'order-1',
      hospitalId: 'hospital-1',
      bloodBankId: 'bank-1',
      bloodType: 'O+',
      quantity: 2,
      deliveryAddress: '123 Main St',
      status,
      riderId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }) as OrderEntity;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new RequestStatusService(
      new OrderStateMachine(),
      eventStore,
      gateway,
      eventEmitter,
      inventoryService,
      blockchainEventRepo,
      notificationsService,
    );
  });

  it('supports approval workflow pending -> approved', async () => {
    const order = createOrder(OrderStatus.PENDING);

    await service.applyStatusUpdate(
      order,
      { action: RequestStatusAction.APPROVE },
      'actor-1',
      'ADMIN',
    );

    expect(order.status).toBe(OrderStatus.CONFIRMED);
    expect(eventStore.persistEvent).toHaveBeenCalled();
    expect(gateway.emitOrderStatusUpdated).toHaveBeenCalled();
  });

  it('requires rejection reason when action is reject', async () => {
    const order = createOrder(OrderStatus.PENDING);

    await expect(
      service.applyStatusUpdate(
        order,
        { action: RequestStatusAction.REJECT },
        'actor-1',
        'ADMIN',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('prevents invalid transition pending -> fulfilled', async () => {
    const order = createOrder(OrderStatus.PENDING);

    await expect(
      service.applyStatusUpdate(
        order,
        { action: RequestStatusAction.FULFILL },
        'actor-1',
        'ADMIN',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('updates inventory on fulfillment', async () => {
    const order = createOrder(OrderStatus.CONFIRMED);

    await service.applyStatusUpdate(
      order,
      { action: RequestStatusAction.FULFILL },
      'actor-1',
      'ADMIN',
    );

    expect(order.status).toBe(OrderStatus.DELIVERED);
    expect(inventoryService.commitFulfillmentStockOrThrow).toHaveBeenCalledWith(
      'bank-1',
      'O+',
      2,
    );
  });

  it('restores inventory on cancellation', async () => {
    const order = createOrder(OrderStatus.CONFIRMED);

    await service.applyStatusUpdate(
      order,
      { action: RequestStatusAction.CANCEL },
      'actor-1',
      'ADMIN',
    );

    expect(order.status).toBe(OrderStatus.CANCELLED);
    expect(inventoryService.restoreStockOrThrow).toHaveBeenCalledWith(
      'bank-1',
      'O+',
      2,
    );
  });

  it('handles blockchain sync failure without aborting transition', async () => {
    blockchainEventRepo.save = jest
      .fn()
      .mockRejectedValue(new Error('sync failed'));

    const order = createOrder(OrderStatus.CONFIRMED);
    await service.applyStatusUpdate(
      order,
      { action: RequestStatusAction.FULFILL },
      'actor-1',
      'ADMIN',
    );

    expect(order.status).toBe(OrderStatus.DELIVERED);
  });

  it('triggers status change notifications', async () => {
    const order = createOrder(OrderStatus.CONFIRMED);

    await service.applyStatusUpdate(
      order,
      { action: RequestStatusAction.FULFILL },
      'actor-1',
      'ADMIN',
    );

    expect(notificationsService.send).toHaveBeenCalled();
  });
});
