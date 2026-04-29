import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { PaginatedResponse, PaginationUtil } from '../common/pagination';
import { OutboxService } from '../events/outbox.service';
import { OutboxEventType } from '../events/outbox-event.entity';
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
import { TenantActorContext, assertTenantAccess } from '../common/tenant/tenant-scope.util';
import { SecurityEventLoggerService, SecurityEventType } from '../user-activity/security-event-logger.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly stateMachine: OrderStateMachine,
    private readonly eventStore: OrderEventStoreService,
    private readonly inventoryService: InventoryService,
    private readonly requestStatusService: RequestStatusService,
    private readonly orderFeeService: OrderFeeService,
    private readonly approvalService: ApprovalService,
    private readonly slaService: SlaService,
    private readonly outboxService: OutboxService,
    private readonly securityEventLogger: SecurityEventLoggerService,
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
    actor?: TenantActorContext,
  ): Promise<PaginatedResponse<Order>> {
    const {
      hospitalId,
      page = 1,
      pageSize = 25,
      sortBy = 'placedAt',
      sortOrder = 'desc',
    } = params;
    const scopedHospitalId =
      actor?.organizationId && (actor.role ?? '').toLowerCase() !== 'admin'
        ? actor.organizationId
        : hospitalId;

    const query = this.orderRepo
      .createQueryBuilder('order')
      .where('order.hospitalId = :hospitalId', { hospitalId: scopedHospitalId });

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

  async findOne(id: string, actor?: TenantActorContext) {
    const order = await this.findOrderOrFail(id, actor);
    return { message: 'Order retrieved successfully', data: order };
  }

  async trackOrder(id: string, actor?: TenantActorContext) {
    const order = await this.findOrderOrFail(id, actor);
    const replayedStatus = await this.eventStore.replayOrderState(id);
    return {
      message: 'Order tracking information retrieved successfully',
      data: { id, status: order.status, replayedStatus },
    };
  }

  async getOrderHistory(orderId: string, actor?: TenantActorContext): Promise<OrderEventEntity[]> {
    await this.findOrderOrFail(orderId, actor);
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

  async update(id: string, updateDto: any, actor?: TenantActorContext) {
    const order = await this.findOrderOrFail(id, actor);
    Object.assign(order, updateDto);
    const updated = await this.orderRepo.save(order);
    return { message: 'Order updated successfully', data: updated };
  }

  async updateStatus(
    id: string,
    statusUpdate: UpdateRequestStatusDto | string,
    actorId?: string,
    actorRole?: string,
    actor?: TenantActorContext,
  ) {
    const dto =
      typeof statusUpdate === 'string'
        ? { status: statusUpdate as OrderStatus }
        : statusUpdate;
    const order = await this.findOrderOrFail(id, actor);
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

  async remove(id: string, actorId?: string, actor?: TenantActorContext) {
    const order = await this.findOrderOrFail(id, actor);
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

  async assignRider(
    orderId: string,
    riderId: string,
    actorId?: string,
    actor?: TenantActorContext,
  ) {
    const order = await this.findOrderOrFail(orderId, actor);
    await this.dataSource.transaction(async (manager) => {
      order.riderId = riderId;
      await manager.save(OrderEntity, order);
      await this.outboxService.publishInTransaction(
        manager,
        OutboxEventType.ORDER_DISPATCHED,
        { orderId, riderId, actorId: actorId ?? null },
        { aggregateId: orderId, aggregateType: 'Order' },
      );
    });
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

  async raiseDispute(
    id: string,
    dto: RaiseDisputeDto,
    actorId?: string,
    actor?: TenantActorContext,
  ) {
    const order = await this.findOrderOrFail(id, actor);
    this.stateMachine.transition(order.status as OrderStatus, OrderStatus.DISPUTED);
    order.status = OrderStatus.DISPUTED;
    order.disputeId = dto.disputeId || `DISP-${id.split('-')[0]}-${Date.now()}`;
    order.disputeReason = dto.reason;
    const saved = await this.dataSource.transaction(async (manager) => {
      const s = await manager.save(OrderEntity, order);
      await this.eventStore.persistEvent({
        orderId: id,
        eventType: OrderEventType.ORDER_DISPUTED,
        payload: { reason: dto.reason, disputeId: order.disputeId },
        actorId,
      });
      await this.outboxService.publishInTransaction(
        manager,
        OutboxEventType.ORDER_DISPUTED,
        { orderId: id, disputeId: order.disputeId, reason: dto.reason, actorId: actorId ?? null },
        { aggregateId: id, aggregateType: 'Order' },
      );
      return s;
    });
    return { message: 'Dispute raised successfully', data: saved };
  }

  async resolveDispute(
    id: string,
    dto: ResolveDisputeDto,
    actorId?: string,
    actor?: TenantActorContext,
  ) {
    const order = await this.findOrderOrFail(id, actor);
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

  async finalizeDisputeResolution(
    id: string,
    resolution: any,
    actor?: TenantActorContext,
  ) {
    const order = await this.findOrderOrFail(id, actor);
    await this.dataSource.transaction(async (manager) => {
      order.status = OrderStatus.RESOLVED;
      await manager.save(OrderEntity, order);
      await this.eventStore.persistEvent({
        orderId: id,
        eventType: OrderEventType.ORDER_RESOLVED,
        payload: { resolution },
        actorId: 'SYSTEM_APPROVAL',
      });
      await this.outboxService.publishInTransaction(
        manager,
        OutboxEventType.ORDER_RESOLVED,
        { orderId: id, resolution },
        { aggregateId: id, aggregateType: 'Order' },
      );
    });
    return { message: 'Dispute resolution finalized and settled.' };
  }

  async previewOrderFees(id: string, overrides: Partial<FeePreviewDto>, actor?: TenantActorContext) {
    const order = await this.findOrderOrFail(id, actor);
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

  private async findOrderOrFail(
    id: string,
    actor?: TenantActorContext,
  ): Promise<OrderEntity> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Order '${id}' not found`);
    if (actor) {
      try {
        assertTenantAccess(actor, {
          resourceType: 'Order',
          resourceId: id,
          ownerIds: [order.hospitalId, order.bloodBankId],
        });
      } catch {
        await this.securityEventLogger
          .logEvent({
            eventType: SecurityEventType.TENANT_ACCESS_DENIED,
            userId: actor.userId,
            description: 'Cross-tenant order access denied',
            metadata: { orderId: id, hospitalId: order.hospitalId, bloodBankId: order.bloodBankId },
          })
          .catch(() => undefined);
        throw new ForbiddenException('Cross-tenant order access denied');
      }
    }
    return order;
  }
}
