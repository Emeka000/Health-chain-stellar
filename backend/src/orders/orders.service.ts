import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { PaginatedResponse, PaginationUtil } from '../common/pagination';
import {
  OrderDisputedEvent,
  OrderRiderAssignedEvent,
  OrderResolvedEvent,
} from '../events';
import { InventoryService } from '../inventory/inventory.service';
import { ApprovalService } from '../approvals/approval.service';
import { ApprovalActionType } from '../approvals/enums/approval.enum';
import { SlaService } from '../sla/sla.service';
import { SlaStage } from '../sla/enums/sla-stage.enum';

import { CreateOrderDto } from './dto/create-order.dto';
import { OrderQueryParamsDto } from './dto/order-query-params.dto';
import { RaiseDisputeDto } from './dto/raise-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';
import { UpdateRequestStatusDto } from './dto/update-request-status.dto';
import { OrderEventEntity } from './entities/order-event.entity';
import { OrderEntity } from './entities/order.entity';
import { OrderEventType } from './enums/order-event-type.enum';
import { OrderStatus } from './enums/order-status.enum';
import { RequestStatusAction } from './enums/request-status-action.enum';
import { OrderStateMachine } from './state-machine/order-state-machine';
import { Order } from './types/order.types';
import { OrderEventStoreService } from './services/order-event-store.service';
import { OrderFeeService } from './services/order-fee.service';
import { RequestStatusService } from './services/request-status.service';
import { FeePreviewDto } from '../fee-policy/dto/fee-policy.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly stateMachine: OrderStateMachine,
    private readonly eventStore: OrderEventStoreService,
    private readonly eventEmitter: EventEmitter2,
    private readonly inventoryService: InventoryService,
    private readonly requestStatusService: RequestStatusService,
    private readonly orderFeeService: OrderFeeService,
    private readonly approvalService: ApprovalService,
    private readonly slaService: SlaService,
  ) {}

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
      page = 1,
      pageSize = 25,
      sortBy = 'placedAt',
      sortOrder = 'desc',
    } = params;
    const query = this.orderRepo
      .createQueryBuilder('order')
      .where('order.hospitalId = :hospitalId', { hospitalId });

    if (params.startDate)
      query.andWhere('order.placedAt >= :startDate', { startDate: params.startDate });
    if (params.endDate)
      query.andWhere('order.placedAt <= :endDate', { endDate: params.endDate });

    const [items, total] = await query
      .orderBy(`order.${sortBy}`, sortOrder.toUpperCase() as any)
      .skip(PaginationUtil.calculateSkip(page, pageSize))
      .take(pageSize)
      .getManyAndCount();

    return PaginationUtil.createResponse(items as any, page, pageSize, total);
  }

  async findOne(id: string) {
    const order = await this.findOrderOrFail(id);
    return { message: 'Order retrieved successfully', data: order };
  }

  async trackOrder(id: string) {
    const order = await this.findOrderOrFail(id);
    const replayedStatus = await this.eventStore.replayOrderState(id);
    return {
      message: 'Order tracking information retrieved successfully',
      data: { id, status: order.status, replayedStatus },
    };
  }

  async getOrderHistory(orderId: string): Promise<OrderEventEntity[]> {
    await this.findOrderOrFail(orderId);
    return this.eventStore.getOrderHistory(orderId);
  }

  async create(dto: CreateOrderDto, actorId?: string) {
    if (!dto.bloodBankId) throw new BadRequestException('bloodBankId is required');
    const saved = await this.createOrderEntity(dto, actorId);
    if (
      saved.status === OrderStatus.CONFIRMED ||
      saved.status === OrderStatus.DISPATCHED
    ) {
      await this.orderFeeService.computeAndPersist(saved);
    }
    return { message: 'Order created successfully', data: saved };
  }

  async update(id: string, updateDto: any) {
    const order = await this.findOrderOrFail(id);
    Object.assign(order, updateDto);
    const updated = await this.orderRepo.save(order);
    return { message: 'Order updated successfully', data: updated };
  }

  async updateStatus(
    id: string,
    statusUpdate: UpdateRequestStatusDto | string,
    actorId?: string,
    actorRole?: string,
  ) {
    const dto =
      typeof statusUpdate === 'string'
        ? { status: statusUpdate as OrderStatus }
        : statusUpdate;
    const order = await this.findOrderOrFail(id);
    const updated = await this.dataSource.transaction(async (manager) => {
      await this.requestStatusService.applyStatusUpdate(
        order,
        dto,
        actorId,
        actorRole,
        manager,
      );
      return manager.save(OrderEntity, order);
    });
    return { message: 'Order status updated successfully', data: updated };
  }

  async remove(id: string, actorId?: string) {
    const order = await this.findOrderOrFail(id);
    await this.dataSource.transaction(async (manager) => {
      await this.requestStatusService.applyStatusUpdate(
        order,
        { action: RequestStatusAction.CANCEL },
        actorId,
        undefined,
        manager,
      );
      await manager.save(OrderEntity, order);
    });
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
    await this.slaService
      .startStage(orderId, SlaStage.DISPATCH_ACCEPTANCE, {
        hospitalId: order.hospitalId,
        bloodBankId: order.bloodBankId ?? undefined,
        riderId,
      })
      .catch((err) =>
        this.logger.error(`SLA DISPATCH_ACCEPTANCE start failed: ${err.message}`),
      );
    return { message: 'Rider assigned successfully', data: { orderId, riderId } };
  }

  async raiseDispute(id: string, dto: RaiseDisputeDto, actorId?: string) {
    const order = await this.findOrderOrFail(id);
    this.stateMachine.transition(order.status as OrderStatus, OrderStatus.DISPUTED);
    order.status = OrderStatus.DISPUTED;
    order.disputeId = dto.disputeId || `DISP-${id.split('-')[0]}-${Date.now()}`;
    order.disputeReason = dto.reason;
    const saved = await this.orderRepo.save(order);
    await this.eventStore.persistEvent({
      orderId: id,
      eventType: OrderEventType.ORDER_DISPUTED,
      payload: { reason: dto.reason, disputeId: order.disputeId },
      actorId,
    });
    this.eventEmitter.emit(
      'order.disputed',
      new OrderDisputedEvent(id, order.disputeId, dto.reason),
    );
    return { message: 'Dispute raised successfully', data: saved };
  }

  async resolveDispute(id: string, dto: ResolveDisputeDto, actorId?: string) {
    const order = await this.findOrderOrFail(id);
    if (order.status !== OrderStatus.DISPUTED)
      throw new ConflictException('Order is not in DISPUTED state');
    const approvalRequest = await this.approvalService.createRequest({
      targetId: id,
      actionType: ApprovalActionType.DISPUTE_RESOLUTION,
      requesterId: actorId!,
      requiredApprovals: 2,
      metadata: { orderId: id, resolution: dto.resolution },
      finalPayload: { ...dto, orderId: id },
    });
    return {
      message: 'Dispute resolution requires multi-party approval.',
      approvalRequestId: approvalRequest.id,
    };
  }

  async finalizeDisputeResolution(id: string, resolution: any) {
    const order = await this.findOrderOrFail(id);
    order.status = OrderStatus.RESOLVED;
    await this.orderRepo.save(order);
    await this.eventStore.persistEvent({
      orderId: id,
      eventType: OrderEventType.ORDER_RESOLVED,
      payload: { resolution },
      actorId: 'SYSTEM_APPROVAL',
    });
    this.eventEmitter.emit('order.resolved', new OrderResolvedEvent(id, resolution));
    return { message: 'Dispute resolution finalized and settled.' };
  }

  async previewOrderFees(id: string, overrides: Partial<FeePreviewDto>) {
    const order = await this.findOrderOrFail(id);
    return this.orderFeeService.preview(order, overrides);
  }

  private async createOrderEntity(
    dto: CreateOrderDto,
    actorId?: string,
  ): Promise<OrderEntity> {
    await this.inventoryService.reserveStockOrThrow(
      dto.bloodBankId!,
      dto.bloodType,
      dto.quantity,
    );
    const order = this.orderRepo.create({
      hospitalId: dto.hospitalId,
      bloodBankId: dto.bloodBankId,
      bloodType: dto.bloodType,
      quantity: dto.quantity,
      deliveryAddress: dto.deliveryAddress,
      status: OrderStatus.PENDING,
    });
    const saved = await this.orderRepo.save(order);
    await this.eventStore.persistEvent({
      orderId: saved.id,
      eventType: OrderEventType.ORDER_CREATED,
      payload: dto,
      actorId,
    });
    await this.slaService
      .startStage(saved.id, SlaStage.TRIAGE, {
        hospitalId: saved.hospitalId,
        bloodBankId: saved.bloodBankId ?? undefined,
      })
      .catch((err) =>
        this.logger.error(`SLA TRIAGE start failed: ${err.message}`),
      );
    return saved;
  }

  private async findOrderOrFail(id: string): Promise<OrderEntity> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Order '${id}' not found`);
    return order;
  }
}
