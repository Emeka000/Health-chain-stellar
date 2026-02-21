import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { OrderStateMachine } from './state-machine/order-state-machine';
import { OrderEventStoreService } from './services/order-event-store.service';
import { OrdersGateway } from './gateways/orders.gateway';
import { OrderEntity } from './entities/order.entity';
import { OrderEventEntity } from './entities/order-event.entity';
import { OrderStatus } from './enums/order-status.enum';
import { OrderEventType } from './enums/order-event-type.enum';
import {
  OrderConfirmedEvent,
  OrderCancelledEvent,
  OrderStatusUpdatedEvent,
  OrderRiderAssignedEvent,
  OrderDispatchedEvent,
  OrderInTransitEvent,
  OrderDeliveredEvent,
} from '../events';

/** Maps each terminal OrderStatus to its corresponding event-store type. */
const STATUS_TO_EVENT_TYPE: Record<OrderStatus, OrderEventType> = {
  [OrderStatus.PENDING]: OrderEventType.ORDER_CREATED,
  [OrderStatus.CONFIRMED]: OrderEventType.ORDER_CONFIRMED,
  [OrderStatus.DISPATCHED]: OrderEventType.ORDER_DISPATCHED,
  [OrderStatus.IN_TRANSIT]: OrderEventType.ORDER_IN_TRANSIT,
  [OrderStatus.DELIVERED]: OrderEventType.ORDER_DELIVERED,
  [OrderStatus.CANCELLED]: OrderEventType.ORDER_CANCELLED,
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly eventEmitter: EventEmitter2,
    private readonly stateMachine: OrderStateMachine,
    private readonly eventStore: OrderEventStoreService,
    private readonly ordersGateway: OrdersGateway,
  ) {}

  // ─── Queries ─────────────────────────────────────────────────────────────

  async findAll(status?: string, hospitalId?: string) {
    const where: Partial<OrderEntity> = {};
    if (status) where.status = status as OrderStatus;
    if (hospitalId) where.hospitalId = hospitalId;

    const orders = await this.orderRepo.find({ where });
    return { message: 'Orders retrieved successfully', data: orders };
  }

  async findAllWithFilters(params: OrderQueryParamsDto): Promise<OrdersResponseDto> {
    const {
      hospitalId,
      startDate,
      endDate,
      bloodTypes,
      statuses,
      bloodBank,
      sortBy = 'placedAt',
      sortOrder = 'desc',
      page = 1,
      pageSize = 25,
    } = params;

    // Start with all orders for the hospital
    let filteredOrders = this.orders.filter(
      (order) => order.hospital.id === hospitalId
    );

    // Apply date range filter
    if (startDate) {
      const start = new Date(startDate);
      filteredOrders = filteredOrders.filter(
        (order) => new Date(order.placedAt) >= start
      );
    }

    if (endDate) {
      const end = new Date(endDate);
      filteredOrders = filteredOrders.filter(
        (order) => new Date(order.placedAt) <= end
      );
    }

    // Apply blood type filter
    if (bloodTypes) {
      const bloodTypeArray = bloodTypes.split(',') as BloodType[];
      filteredOrders = filteredOrders.filter((order) =>
        bloodTypeArray.includes(order.bloodType)
      );
    }

    // Apply status filter
    if (statuses) {
      const statusArray = statuses.split(',') as OrderStatus[];
      filteredOrders = filteredOrders.filter((order) =>
        statusArray.includes(order.status)
      );
    }

    // Apply blood bank name filter (case-insensitive partial match)
    if (bloodBank) {
      const searchTerm = bloodBank.toLowerCase();
      filteredOrders = filteredOrders.filter((order) =>
        order.bloodBank.name.toLowerCase().includes(searchTerm)
      );
    }

    // Sort orders with active orders prioritization
    const activeStatuses: OrderStatus[] = ['pending', 'confirmed', 'in_transit'];
    filteredOrders.sort((a, b) => {
      // First, prioritize active orders
      const aIsActive = activeStatuses.includes(a.status);
      const bIsActive = activeStatuses.includes(b.status);

      if (aIsActive && !bIsActive) return -1;
      if (!aIsActive && bIsActive) return 1;

      // Then apply column sorting
      const aValue = this.getSortValue(a, sortBy);
      const bValue = this.getSortValue(b, sortBy);

      if (aValue < bValue) return sortOrder === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    // Calculate pagination
    const totalCount = filteredOrders.length;
    const totalPages = Math.ceil(totalCount / pageSize);
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;

    // Get paginated results
    const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

    return {
      data: paginatedOrders,
      pagination: {
        currentPage: page,
        pageSize,
        totalCount,
        totalPages,
      },
    };
  }

  private getSortValue(order: Order, sortBy: string): any {
    switch (sortBy) {
      case 'id':
        return order.id;
      case 'bloodType':
        return order.bloodType;
      case 'quantity':
        return order.quantity;
      case 'bloodBank':
        return order.bloodBank.name;
      case 'status':
        return order.status;
      case 'rider':
        return order.rider?.name || '';
      case 'placedAt':
        return new Date(order.placedAt).getTime();
      case 'deliveredAt':
        return order.deliveredAt ? new Date(order.deliveredAt).getTime() : 0;
      default:
        return new Date(order.placedAt).getTime();
    }
  }

  async findOne(id: string) {
    const order = await this.findOrderOrFail(id);
    return { message: 'Order retrieved successfully', data: order };
  }

  async trackOrder(id: string) {
    const order = await this.findOrderOrFail(id);
    // Derive state by replaying the event log — decoupled from the status column.
    const replayedStatus = await this.eventStore.replayOrderState(id);
    return {
      message: 'Order tracking information retrieved successfully',
      data: { id, status: order.status, replayedStatus },
    };
  }

  /**
   * Returns the full, chronologically-ordered audit log for an order.
   * Satisfies the GET /orders/:id/history acceptance criterion.
   */
  async getOrderHistory(orderId: string): Promise<OrderEventEntity[]> {
    await this.findOrderOrFail(orderId); // 404 guard
    return this.eventStore.getOrderHistory(orderId);
  }

  // ─── Commands ─────────────────────────────────────────────────────────────

  async create(createOrderDto: any, actorId?: string) {
    const order = this.orderRepo.create({
      hospitalId: createOrderDto.hospitalId,
      bloodType: createOrderDto.bloodType,
      quantity: createOrderDto.quantity,
      deliveryAddress: createOrderDto.deliveryAddress,
      status: OrderStatus.PENDING,
      riderId: null,
    });

    const saved = await this.orderRepo.save(order);

    // Persist the creation event — marks order as PENDING in the event store.
    await this.eventStore.persistEvent({
      orderId: saved.id,
      eventType: OrderEventType.ORDER_CREATED,
      payload: {
        hospitalId: saved.hospitalId,
        bloodType: saved.bloodType,
        quantity: saved.quantity,
        deliveryAddress: saved.deliveryAddress,
      },
      actorId,
    });

    this.logger.log(`Order created: ${saved.id}`);
    return { message: 'Order created successfully', data: saved };
  }

  async update(id: string, updateOrderDto: any) {
    const order = await this.findOrderOrFail(id);
    Object.assign(order, updateOrderDto);
    const updated = await this.orderRepo.save(order);
    return { message: 'Order updated successfully', data: updated };
  }

  /**
   * Drives the order through a state transition.
   * Internally calls `transitionStatus` which enforces the state machine,
   * persists the event, and emits both an internal domain event and a
   * WebSocket notification.
   */
  async updateStatus(id: string, status: string, actorId?: string) {
    const nextStatus = status as OrderStatus;
    return this.transitionStatus(id, nextStatus, actorId);
  }

  /**
   * Cancels an order by transitioning it to CANCELLED.
   * Delegates to the state machine — an already-delivered order cannot
   * be cancelled and will throw OrderTransitionException.
   */
  async remove(id: string, actorId?: string) {
    await this.transitionStatus(id, OrderStatus.CANCELLED, actorId);
    return { message: 'Order cancelled successfully', data: { id } };
  }

  async assignRider(orderId: string, riderId: string, actorId?: string) {
    const order = await this.findOrderOrFail(orderId);
    order.riderId = riderId;
    await this.orderRepo.save(order);

    this.eventEmitter.emit(
      'order.rider.assigned',
      new OrderRiderAssignedEvent(orderId, riderId),
    );

    return { message: 'Rider assigned successfully', data: { orderId, riderId } };
  }

  // ─── Core state-transition pipeline ──────────────────────────────────────

  /**
   * The single choke-point for every order state change:
   *
   * 1. Load the order and read its current status.
   * 2. Ask the state machine to validate (throws OrderTransitionException on
   *    invalid edges — e.g. DELIVERED → DISPATCHED).
   * 3. Append an immutable row to the order_events table (event store).
   * 4. Persist the updated status on the orders row.
   * 5. Emit the specific NestJS domain event (e.g. OrderDispatchedEvent).
   * 6. Broadcast `order.status.updated` over WebSocket to all connected clients.
   */
  private async transitionStatus(
    orderId: string,
    nextStatus: OrderStatus,
    actorId?: string,
  ): Promise<{ message: string; data: OrderEntity }> {
    const order = await this.findOrderOrFail(orderId);
    const previousStatus = order.status;

    // ① Validate — throws OrderTransitionException if the edge is illegal.
    this.stateMachine.transition(previousStatus, nextStatus);

    // ② Persist to the event store (immutable append).
    const eventType = STATUS_TO_EVENT_TYPE[nextStatus];
    await this.eventStore.persistEvent({
      orderId,
      eventType,
      payload: { previousStatus, newStatus: nextStatus },
      actorId,
    });

    // ③ Update the mutable status column.
    order.status = nextStatus;
    const updated = await this.orderRepo.save(order);

    // ④ Emit internal NestJS domain events.
    this.emitDomainEvent(updated, previousStatus, nextStatus);

    // ⑤ Broadcast WebSocket notification.
    this.ordersGateway.emitOrderStatusUpdated({
      orderId,
      previousStatus,
      newStatus: nextStatus,
      eventType,
      actorId: actorId ?? null,
      timestamp: new Date(),
    });

    this.logger.log(
      `Order ${orderId} transitioned: ${previousStatus} → ${nextStatus}`,
    );

    return { message: 'Order status updated successfully', data: updated };
  }

  /** Fires the fine-grained domain event that corresponds to `nextStatus`. */
  private emitDomainEvent(
    order: OrderEntity,
    previousStatus: OrderStatus,
    nextStatus: OrderStatus,
  ): void {
    // Generic catch-all event (consumed by DispatchService, etc.)
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
          new OrderCancelledEvent(order.id, order.hospitalId, 'Status transition'),
        );
        break;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findOrderOrFail(id: string): Promise<OrderEntity> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order '${id}' not found`);
    }
    return order;
  }
}
