import { BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { NotificationDispatchService } from '../../common/services/notification-dispatch.service';
import { InventoryService } from '../../inventory/inventory.service';
import { OrderEntity } from '../entities/order.entity';
import { OrderStatus } from '../enums/order-status.enum';
import { RequestStatusAction } from '../enums/request-status-action.enum';
import { OrdersGateway } from '../gateways/orders.gateway';
import { OrderStateMachine } from '../state-machine/order-state-machine';
import { OrderEventStoreService } from './order-event-store.service';
import { RequestStatusService } from './request-status.service';

// ── Factory ───────────────────────────────────────────────────────────────────

const makeOrder = (status: OrderStatus): OrderEntity =>
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

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('RequestStatusService', () => {
  let service: RequestStatusService;

  const eventStore = {
    persistEvent: jest.fn().mockResolvedValue(undefined),
    persistEventWithManager: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<OrderEventStoreService>;

  const gateway = {
    emitOrderStatusUpdated: jest.fn(),
  } as unknown as jest.Mocked<OrdersGateway>;

  const eventEmitter = {
    emit: jest.fn(),
  } as unknown as jest.Mocked<EventEmitter2>;

  const inventoryService = {
    restoreStockOrThrow: jest.fn().mockResolvedValue(undefined),
    commitFulfillmentStockOrThrow: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<InventoryService>;

  const blockchainEventRepo = {
    create: jest.fn().mockImplementation((input) => input),
    save: jest.fn().mockResolvedValue(undefined),
  } as any;

  const notificationDispatch = {
    dispatch: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<NotificationDispatchService>;

  const permissionsService = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RequestStatusService(
      new OrderStateMachine(),
      eventStore,
      gateway,
      eventEmitter,
      inventoryService,
      permissionsService,
      blockchainEventRepo,
      notificationDispatch,
    );
  });

  // ── Status transitions ──────────────────────────────────────────────────────

  describe('applyStatusUpdate — transitions', () => {
    it('PENDING → CONFIRMED via APPROVE action', async () => {
      const order = makeOrder(OrderStatus.PENDING);
      await service.applyStatusUpdate(order, { action: RequestStatusAction.APPROVE }, 'actor-1', 'ADMIN');
      expect(order.status).toBe(OrderStatus.CONFIRMED);
    });

    it('CONFIRMED → DELIVERED via FULFILL action', async () => {
      const order = makeOrder(OrderStatus.CONFIRMED);
      await service.applyStatusUpdate(order, { action: RequestStatusAction.FULFILL }, 'actor-1', 'ADMIN');
      expect(order.status).toBe(OrderStatus.DELIVERED);
    });

    it('CONFIRMED → CANCELLED via CANCEL action', async () => {
      const order = makeOrder(OrderStatus.CONFIRMED);
      await service.applyStatusUpdate(order, { action: RequestStatusAction.CANCEL }, 'actor-1', 'ADMIN');
      expect(order.status).toBe(OrderStatus.CANCELLED);
    });

    it('PENDING → CANCELLED via REJECT action with reason', async () => {
      const order = makeOrder(OrderStatus.PENDING);
      await service.applyStatusUpdate(
        order,
        { action: RequestStatusAction.REJECT, reason: 'out of stock' },
        'actor-1',
        'ADMIN',
      );
      expect(order.status).toBe(OrderStatus.CANCELLED);
    });
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  describe('applyStatusUpdate — validation', () => {
    it('throws BadRequestException when REJECT has no reason', async () => {
      const order = makeOrder(OrderStatus.PENDING);
      await expect(
        service.applyStatusUpdate(order, { action: RequestStatusAction.REJECT }, 'actor-1', 'ADMIN'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when neither action nor status is provided', async () => {
      const order = makeOrder(OrderStatus.PENDING);
      await expect(
        service.applyStatusUpdate(order, {} as any, 'actor-1', 'ADMIN'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws on invalid state machine transition (PENDING → DELIVERED)', async () => {
      const order = makeOrder(OrderStatus.PENDING);
      await expect(
        service.applyStatusUpdate(order, { status: OrderStatus.DELIVERED }, 'actor-1', 'ADMIN'),
      ).rejects.toThrow();
    });
  });

  // ── Side effects ────────────────────────────────────────────────────────────

  describe('applyStatusUpdate — side effects', () => {
    it('persists event to event store', async () => {
      const order = makeOrder(OrderStatus.PENDING);
      await service.applyStatusUpdate(order, { action: RequestStatusAction.APPROVE }, 'actor-1', 'ADMIN');
      expect(eventStore.persistEvent).toHaveBeenCalled();
    });

    it('emits gateway update', async () => {
      const order = makeOrder(OrderStatus.PENDING);
      await service.applyStatusUpdate(order, { action: RequestStatusAction.APPROVE }, 'actor-1', 'ADMIN');
      expect(gateway.emitOrderStatusUpdated).toHaveBeenCalled();
    });

    it('restores inventory on CANCEL', async () => {
      const order = makeOrder(OrderStatus.CONFIRMED);
      await service.applyStatusUpdate(order, { action: RequestStatusAction.CANCEL }, 'actor-1', 'ADMIN');
      expect(inventoryService.restoreStockOrThrow).toHaveBeenCalledWith('bank-1', 'O+', 2);
    });

    it('commits fulfillment stock on DELIVER', async () => {
      const order = makeOrder(OrderStatus.CONFIRMED);
      await service.applyStatusUpdate(order, { action: RequestStatusAction.FULFILL }, 'actor-1', 'ADMIN');
      expect(inventoryService.commitFulfillmentStockOrThrow).toHaveBeenCalledWith('bank-1', 'O+', 2);
    });

    it('dispatches notification via NotificationDispatchService', async () => {
      const order = makeOrder(OrderStatus.CONFIRMED);
      await service.applyStatusUpdate(order, { action: RequestStatusAction.FULFILL }, 'actor-1', 'ADMIN');
      expect(notificationDispatch.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 'hospital-1', templateKey: 'order.status.updated' }),
      );
    });

    it('does not throw when blockchain sync fails', async () => {
      blockchainEventRepo.save.mockRejectedValueOnce(new Error('sync failed'));
      const order = makeOrder(OrderStatus.CONFIRMED);
      await expect(
        service.applyStatusUpdate(order, { action: RequestStatusAction.FULFILL }, 'actor-1', 'ADMIN'),
      ).resolves.toBeDefined();
    });

    it('uses transactional manager when provided', async () => {
      const order = makeOrder(OrderStatus.PENDING);
      const manager = { getRepository: jest.fn().mockReturnValue(blockchainEventRepo) };
      await service.applyStatusUpdate(
        order,
        { action: RequestStatusAction.APPROVE },
        'actor-1',
        'ADMIN',
        manager as any,
      );
      expect(eventStore.persistEventWithManager).toHaveBeenCalledWith(
        manager,
        expect.any(Object),
      );
    });
  });

  // ── Role enforcement ────────────────────────────────────────────────────────

  describe('applyStatusUpdate — role enforcement', () => {
    it('throws BadRequestException when non-admin tries to APPROVE', async () => {
      const order = makeOrder(OrderStatus.PENDING);
      await expect(
        service.applyStatusUpdate(order, { action: RequestStatusAction.APPROVE }, 'actor-1', 'RIDER'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows RIDER to FULFILL', async () => {
      const order = makeOrder(OrderStatus.CONFIRMED);
      await expect(
        service.applyStatusUpdate(order, { action: RequestStatusAction.FULFILL }, 'actor-1', 'RIDER'),
      ).resolves.toBeDefined();
    });
  });
});
