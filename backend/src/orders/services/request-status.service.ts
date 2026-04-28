import {
  BadRequestException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  OrderCancelledEvent,
  OrderConfirmedEvent,
  OrderDeliveredEvent,
  OrderDispatchedEvent,
  OrderInTransitEvent,
  OrderStatusUpdatedEvent,
} from '../../events';
import { InventoryService } from '../../inventory/inventory.service';
import { NotificationDispatchService } from '../../common/services/notification-dispatch.service';
import { BlockchainEvent } from '../../soroban/entities/blockchain-event.entity';
import { UpdateRequestStatusDto } from '../dto/update-request-status.dto';
import { OrderEntity } from '../entities/order.entity';
import { OrderEventType } from '../enums/order-event-type.enum';
import { OrderStatus } from '../enums/order-status.enum';
import { RequestStatusAction } from '../enums/request-status-action.enum';
import { OrdersGateway } from '../gateways/orders.gateway';
import { OrderStateMachine } from '../state-machine/order-state-machine';

import { OrderEventStoreService } from './order-event-store.service';

const STATUS_TO_EVENT_TYPE: Record<OrderStatus, OrderEventType> = {
  [OrderStatus.PENDING]: OrderEventType.ORDER_CREATED,
  [OrderStatus.CONFIRMED]: OrderEventType.ORDER_CONFIRMED,
  [OrderStatus.DISPATCHED]: OrderEventType.ORDER_DISPATCHED,
  [OrderStatus.IN_TRANSIT]: OrderEventType.ORDER_IN_TRANSIT,
  [OrderStatus.DELIVERED]: OrderEventType.ORDER_DELIVERED,
  [OrderStatus.CANCELLED]: OrderEventType.ORDER_CANCELLED,
};

@Injectable()
export class RequestStatusService {
  private readonly logger = new Logger(RequestStatusService.name);

  constructor(
    private readonly stateMachine: OrderStateMachine,
    private readonly eventStore: OrderEventStoreService,
    private readonly ordersGateway: OrdersGateway,
    private readonly eventEmitter: EventEmitter2,
    private readonly inventoryService: InventoryService,
    private readonly permissionsService: PermissionsService,
    @Optional()
    @InjectRepository(BlockchainEvent)
    private readonly blockchainEventRepo?: Repository<BlockchainEvent>,
    @Optional()
    private readonly notificationDispatch?: NotificationDispatchService,
  ) {}

  async applyStatusUpdate(
    order: OrderEntity,
    dto: UpdateRequestStatusDto,
    actorId?: string,
    actorRole?: string,
    manager?: EntityManager,
  ): Promise<{ nextStatus: OrderStatus; eventType: OrderEventType }> {
    const nextStatus = this.resolveNextStatus(dto);
    const previousStatus = order.status;

    if (actorRole) {
      this.enforceActionRole(dto.action, {
        id: actorId ?? '',
        role: actorRole,
      });
    }
    this.stateMachine.transition(previousStatus, nextStatus);

    const eventType = STATUS_TO_EVENT_TYPE[nextStatus];

    // Use the provided manager (transactional) or fall back to the default repo manager.
    if (manager) {
      await this.eventStore.persistEventWithManager(manager, {
        orderId: order.id,
        eventType,
        payload: {
          previousStatus,
          newStatus: nextStatus,
          action: dto.action ?? null,
          reason: dto.reason ?? null,
          comment: dto.comment ?? null,
        },
        actorId,
      });
    } else {
      await this.eventStore.persistEvent({
        orderId: order.id,
        eventType,
        payload: {
          previousStatus,
          newStatus: nextStatus,
          action: dto.action ?? null,
          reason: dto.reason ?? null,
          comment: dto.comment ?? null,
        },
        actorId,
      });
    }

    if (
      nextStatus === OrderStatus.CANCELLED &&
      previousStatus !== OrderStatus.DELIVERED
    ) {
      await this.inventoryService.restoreStockOrThrow(
        order.bloodBankId ?? '',
        order.bloodType,
        Number(order.quantity),
      );
    }

    if (nextStatus === OrderStatus.DELIVERED) {
      await this.inventoryService.commitFulfillmentStockOrThrow(
        order.bloodBankId ?? '',
        order.bloodType,
        Number(order.quantity),
      );
    }

    order.status = nextStatus;

    this.emitDomainEvent(order, previousStatus, nextStatus, dto.reason);

    this.ordersGateway.emitOrderStatusUpdated({
      orderId: order.id,
      previousStatus,
      newStatus: nextStatus,
      eventType,
      actorId: actorId ?? null,
      timestamp: new Date(),
    });

    await this.trySyncWithBlockchain(
      order,
      previousStatus,
      nextStatus,
      actorId,
      dto.reason,
    );
    await this.tryNotifyStatusChange(
      order,
      previousStatus,
      nextStatus,
      dto.reason,
    );

    this.logger.log(
      `Request ${order.id} status updated: ${previousStatus} -> ${nextStatus}`,
    );

    return { nextStatus, eventType };
  }

  private resolveNextStatus(dto: UpdateRequestStatusDto): OrderStatus {
    if (dto.status) {
      return dto.status;
    }

    switch (dto.action) {
      case RequestStatusAction.APPROVE:
        return OrderStatus.CONFIRMED;
      case RequestStatusAction.REJECT:
        if (!dto.reason) {
          throw new BadRequestException(
            'A reason is required when rejecting a request.',
          );
        }
        return OrderStatus.CANCELLED;
      case RequestStatusAction.FULFILL:
        return OrderStatus.DELIVERED;
      case RequestStatusAction.CANCEL:
        return OrderStatus.CANCELLED;
      default:
        throw new BadRequestException(
          'Either action or status must be provided.',
        );
    }
  }

  private enforceActionRole(
    action: RequestStatusAction | undefined,
    actorRole?: string,
  ): void {
    if (!action || !actorRole) {
      return;
    }

    const normalizedRole = actorRole.toUpperCase();

    const approvalRoles = new Set(['ADMIN', 'BLOOD_BANK', 'BLOOD_BANK_STAFF']);
    const fulfillmentRoles = new Set([
      'ADMIN',
      'RIDER',
      'DISPATCHER',
      'BLOOD_BANK',
      'BLOOD_BANK_STAFF',
    ]);

    if (
      (action === RequestStatusAction.APPROVE ||
        action === RequestStatusAction.REJECT) &&
      !approvalRoles.has(normalizedRole)
    ) {
      throw new BadRequestException(
        `Role '${actorRole}' is not allowed to ${action.toLowerCase()} requests.`,
      );
    }

    if (
      action === RequestStatusAction.FULFILL &&
      !fulfillmentRoles.has(normalizedRole)
    ) {
      throw new BadRequestException(
        `Role '${actorRole}' is not allowed to fulfill requests.`,
      );
    }
  }

  private emitDomainEvent(
    order: OrderEntity,
    previousStatus: OrderStatus,
    nextStatus: OrderStatus,
    reason?: string,
  ): void {
    this.eventEmitter.emit(
      'order.status.updated',
      new OrderStatusUpdatedEvent(order.id, previousStatus, nextStatus),
    );

    switch (nextStatus) {
      case OrderStatus.CONFIRMED:
        this.eventEmitter.emit(
          'order.confirmed',
          new OrderConfirmedEvent(
            order.id,
            order.hospitalId,
            order.bloodType,
            order.quantity,
            order.deliveryAddress,
          ),
        );
        break;

      case OrderStatus.DISPATCHED:
        this.eventEmitter.emit(
          'order.dispatched',
          new OrderDispatchedEvent(order.id, order.riderId ?? ''),
        );
        break;

      case OrderStatus.IN_TRANSIT:
        this.eventEmitter.emit(
          'order.in_transit',
          new OrderInTransitEvent(order.id),
        );
        break;

      case OrderStatus.DELIVERED:
        this.eventEmitter.emit(
          'order.delivered',
          new OrderDeliveredEvent(order.id),
        );
        break;

      case OrderStatus.CANCELLED:
        this.eventEmitter.emit(
          'order.cancelled',
          new OrderCancelledEvent(
            order.id,
            order.hospitalId,
            reason ?? 'Status transition',
          ),
        );
        break;
    }
  }

  private async trySyncWithBlockchain(
    order: OrderEntity,
    previousStatus: OrderStatus,
    nextStatus: OrderStatus,
    actorId?: string,
    reason?: string,
    manager?: EntityManager,
  ): Promise<void> {
    if (!this.blockchainEventRepo) {
      return;
    }

    try {
      const repo = manager
        ? manager.getRepository(BlockchainEvent)
        : this.blockchainEventRepo;

      const txHash = `order-status-${order.id}-${Date.now()}`;
      const entity = repo.create({
        eventType: 'ORDER_STATUS_UPDATED',
        transactionHash: txHash,
        eventData: {
          orderId: order.id,
          previousStatus,
          nextStatus,
          actorId: actorId ?? null,
          reason: reason ?? null,
        },
        blockchainTimestamp: new Date(),
        processed: false,
      });

      await repo.save(entity);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(
        `Blockchain sync failed for order ${order.id}: ${message}`,
      );
    }
  }

  private async tryNotifyStatusChange(
    order: OrderEntity,
    previousStatus: OrderStatus,
    nextStatus: OrderStatus,
    reason?: string,
  ): Promise<void> {
    if (!this.notificationDispatch) return;
    await this.notificationDispatch.dispatch({
      recipientId: order.hospitalId,
      templateKey: 'order.status.updated',
      variables: {
        orderId: order.id,
        previousStatus,
        newStatus: nextStatus,
        reason: reason ?? '',
      },
    });
  }
}
