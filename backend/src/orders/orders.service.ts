import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { OptimisticLockVersionMismatchError, Repository } from 'typeorm';

import { PaginatedResponse, PaginationUtil } from '../common/pagination';
import {
  OrderConfirmedEvent,
  OrderCancelledEvent,
  OrderStatusUpdatedEvent,
  OrderRiderAssignedEvent,
  OrderDispatchedEvent,
  OrderInTransitEvent,
  OrderDeliveredEvent,
  OrderDisputedEvent,
  OrderResolvedEvent,
} from '../events';
import { InventoryService } from '../inventory/inventory.service';

import { OrderQueryParamsDto } from './dto/order-query-params.dto';
import { OrdersResponseDto } from './dto/orders-response.dto';
import { UpdateRequestStatusDto } from './dto/update-request-status.dto';
import { OrderEventEntity } from './entities/order-event.entity';
import { OrderEntity } from './entities/order.entity';
import { OrderEventType } from './enums/order-event-type.enum';
import { OrderStatus } from './enums/order-status.enum';
import { RequestStatusAction } from './enums/request-status-action.enum';
import { OrderEventStoreService } from './services/order-event-store.service';
import { FeePolicyService } from '../fee-policy/fee-policy.service';
import { FeePreviewDto } from '../fee-policy/dto/fee-policy.dto';
import { FeeBreakdownDto } from '../fee-policy/dto/fee-policy.dto';
import { RequestStatusService } from './services/request-status.service';
import { OrderStateMachine } from './state-machine/order-state-machine';
import { Order, BloodType } from './types/order.types';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly orders: Order[] = [];

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly stateMachine: OrderStateMachine,
    private readonly eventStore: OrderEventStoreService,
    private readonly eventEmitter: EventEmitter2,
    private readonly inventoryService: InventoryService,
    private readonly requestStatusService: RequestStatusService,
    private readonly feePolicyService: FeePolicyService,
  ) { }

  // ─── Queries ─────────────────────────────────────────────────────────────

  async findAll(status?: string, hospitalId?: string) {
    const where: Partial<OrderEntity> = {};
    if (status) where.status = status as OrderStatus;
    if (hospitalId) where.hospitalId = hospitalId;

    const orders = await this.orderRepo.find({ where });
    return { message: 'Orders retrieved successfully', data: orders };
  }

  async findAllWithFilters(
    params: OrderQueryParamsDto,
  ): Promise<PaginatedResponse<Order>> {
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
      (order) => order.hospital.id === hospitalId,
    );

    // Apply date range filter
    if (startDate) {
      const start = new Date(startDate);
      filteredOrders = filteredOrders.filter(
        (order) => new Date(order.placedAt) >= start,
      );
    }

    if (endDate) {
      const end = new Date(endDate);
      filteredOrders = filteredOrders.filter(
        (order) => new Date(order.placedAt) <= end,
      );
    }

    // Apply blood type filter
    if (bloodTypes) {
      const bloodTypeArray = bloodTypes.split(',') as BloodType[];
      filteredOrders = filteredOrders.filter((order) =>
        bloodTypeArray.includes(order.bloodType),
      );
    }

    // Apply status filter
    if (statuses) {
      const statusArray = statuses.split(',') as OrderStatus[];
      filteredOrders = filteredOrders.filter((order) =>
        statusArray.includes(order.status),
      );
    }

    // Apply blood bank name filter (case-insensitive partial match)
    if (bloodBank) {
      const searchTerm = bloodBank.toLowerCase();
      filteredOrders = filteredOrders.filter((order) =>
        order.bloodBank.name.toLowerCase().includes(searchTerm),
      );
    }

    // Sort orders with active orders prioritization
    const activeStatuses = ['pending', 'confirmed', 'in_transit'];
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
    const skip = PaginationUtil.calculateSkip(page, pageSize);
    const paginatedOrders = filteredOrders.slice(skip, skip + pageSize);

    return PaginationUtil.createResponse(
      paginatedOrders,
      page,
      pageSize,
      totalCount,
    );
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

  async create(createOrderDto: CreateOrderDto, actorId?: string) {
    if (!createOrderDto.bloodBankId) {
      throw new BadRequestException(
        'bloodBankId is required to place an order.',
      );
    }

    const saved = await this.createOrderEntity(createOrderDto, actorId);

    // Compute and save fees for confirmed orders (on create, status PENDING, compute on transition)
    if (saved.status === OrderStatus.CONFIRMED || saved.status === OrderStatus.DISPATCHED) {
      await this.computeFees(saved);
    }

    this.logger.log(`Order created: ${saved.id}`);
    return { message: 'Order created successfully', data: saved };
  }

  private async createOrderEntity(createOrderDto: CreateOrderDto, actorId?: string): Promise<OrderEntity> {
    try {
      await this.inventoryService.reserveStockOrThrow(
        createOrderDto.bloodBankId!,
        createOrderDto.bloodType,
        createOrderDto.quantity,
      );
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new ConflictException(
        'Unable to reserve inventory at the moment. Please retry your request.',
      );
    }

    const order = this.orderRepo.create({
      hospitalId: createOrderDto.hospitalId,
      bloodBankId: createOrderDto.bloodBankId,
      bloodType: createOrderDto.bloodType,
      quantity: createOrderDto.quantity,
      deliveryAddress: createOrderDto.deliveryAddress,
      status: OrderStatus.PENDING,
      riderId: null,
    });

    const saved = await this.orderRepo.save(order);

    await this.eventStore.persistEvent({
      orderId: saved.id,
      eventType: OrderEventType.ORDER_CREATED,
      payload: {
        hospitalId: saved.hospitalId,
        bloodBankId: saved.bloodBankId,
        bloodType: saved.bloodType,
        quantity: saved.quantity,
        deliveryAddress: saved.deliveryAddress,
      },
      actorId,
    });

    return saved;
  }

  async computeFees(order: OrderEntity): Promise<void> {
    // Extract inputs from order (TODO: integrate maps for distance, config for geography)
    const previewDto: FeePreviewDto = {
      geographyCode: 'LAG', // Default, make configurable
      urgencyTier: 'STANDARD' as any, // From order status/service level
      distanceKm: 10, // From maps or DTO
      serviceLevel: 'BASIC' as any,
      quantity: order.quantity,
    };

    const breakdown = await this.feePolicyService.previewFees(previewDto);
    order.feeBreakdown = breakdown as any;
    order.appliedPolicyId = breakdown.appliedPolicyId;
    await this.orderRepo.save(order);
  }

  async update(id: string, updateOrderDto: any) {
    const order = await this.findOrderOrFail(id);
    if (
      updateOrderDto.version !== undefined &&
      updateOrderDto.version !== order.version
    ) {
      throw new ConflictException(
        `Order '${id}' was modified by another request. Fetch the latest version and retry.`,
      );
    }
    Object.assign(order, updateOrderDto);
    try {
      const updated = await this.orderRepo.save(order);
      return { message: 'Order updated successfully', data: updated };
    } catch (err) {
      if (err instanceof OptimisticLockVersionMismatchError) {
        throw new ConflictException(
          `Order '${id}' was modified by another request. Fetch the latest version and retry.`,
        );
      }
      throw err;
    }
  }

  /**
   * Drives the order through a state transition.
   * Internally calls `transitionStatus` which enforces the state machine,
   * persists the event, and emits both an internal domain event and a
   * WebSocket notification.
   */
  async updateStatus(
    id: string,
    statusUpdate: UpdateRequestStatusDto | string,
    actorId?: string,
    actorRole?: string,
  ) {
    const dto: UpdateRequestStatusDto =
      typeof statusUpdate === 'string'
        ? { status: statusUpdate as OrderStatus }
        : statusUpdate;

    const order = await this.findOrderOrFail(id);
    await this.requestStatusService.applyStatusUpdate(
      order,
      dto,
      actorId,
      actorRole,
    );

    // Compute fees for confirmed/dispatched
    if (order.status === OrderStatus.CONFIRMED || order.status === OrderStatus.DISPATCHED || order.status === OrderStatus.IN_TRANSIT) {
      await this.computeFees(order);
    }

    try {
      const updated = await this.orderRepo.save(order);
      return { message: 'Order status updated successfully', data: updated };
    } catch (err) {
      if (err instanceof OptimisticLockVersionMismatchError) {
        throw new ConflictException(
          `Order '${id}' was modified by another request. Fetch the latest version and retry.`,
        );
      }
      throw err;
    }
  }

  /**
   * Cancels an order by transitioning it to CANCELLED.
   * Delegates to the state machine — an already-delivered order cannot
   * be cancelled and will throw OrderTransitionException.
   */
  async remove(id: string, actorId?: string) {
    const order = await this.findOrderOrFail(id);
    await this.requestStatusService.applyStatusUpdate(
      order,
      { action: RequestStatusAction.CANCEL },
      actorId,
    );
    await this.orderRepo.save(order);
    return { message: 'Order cancelled successfully', data: { id } };
  }

  async assignRider(orderId: string, riderId: string, actorId?: string) {
    const order = await this.findOrderOrFail(orderId);
    order.riderId = riderId;
    try {
      await this.orderRepo.save(order);
    } catch (err) {
      if (err instanceof OptimisticLockVersionMismatchError) {
        throw new ConflictException(
          `Order '${orderId}' was modified by another request. Fetch the latest version and retry.`,
        );
      }
      throw err;
    }

    this.eventEmitter.emit(
      'order.rider.assigned',
      new OrderRiderAssignedEvent(orderId, riderId),
    );

    return {
      message: 'Rider assigned successfully',
      data: { orderId, riderId },
    };
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
