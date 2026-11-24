import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
  Inject,
} from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';

import {
  OrderCancelledEvent,
  OrderStatusUpdatedEvent,
  OrderRiderAssignedEvent,
} from '../events';
import { BloodUnit } from '../blood-units/entities/blood-unit.entity';
import { BloodStatus } from '../blood-units/enums/blood-status.enum';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/enums/order-status.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationChannel } from '../notifications/enums/notification-channel.enum';
import type { ColdChainBreachEvent } from '../cold-chain/cold-chain.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

import { RiderAssignmentService } from './rider-assignment.service';
import {
  DispatchRecord,
  DispatchStatus,
  DispatchStatusHistory,
  ALLOWED_TRANSITIONS,
} from './entities/dispatch-record.entity';
import { CreateDispatchDto, UpdateDispatchDto } from './dto/dispatch.dto';

/** TTL for event dedup keys in Redis (1 hour) */
const DEDUP_TTL_SECONDS = 3600;
const DEDUP_KEY_PREFIX = 'dispatch:dedup:';

/**
 * Minimal shape of the authenticated caller passed from the controller.
 * Access tokens carry no riderId, so the rider record is resolved from the DB.
 */
export interface DispatchActor {
  id: string;
  organizationId?: string;
  role?: string;
  riderId?: string;
}

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly riderAssignmentService: RiderAssignmentService,
    @InjectRepository(BloodUnit)
    private readonly bloodUnitRepo: Repository<BloodUnit>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    @InjectRepository(DispatchRecord)
    private readonly dispatchRepo: Repository<DispatchRecord>,
    @InjectRepository(DispatchStatusHistory)
    private readonly historyRepo: Repository<DispatchStatusHistory>,
    private readonly notificationsService: NotificationsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ---------------------------------------------------------------------------
  // Redis-backed atomic deduplication (fixes #526)
  // ---------------------------------------------------------------------------

  private dedupKey(eventName: string, orderId: string, timestamp: Date): string {
    return `${DEDUP_KEY_PREFIX}${eventName}:${orderId}:${timestamp.getTime()}`;
  }

  /**
   * Atomically sets the dedup key with NX + EX.
   * Returns true if this is the FIRST time we see this key (proceed).
   * Returns false if the key already exists (duplicate — skip).
   */
  private async acquireDedup(key: string): Promise<boolean> {
    try {
      const result = await this.redis.set(key, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
      return result === 'OK';
    } catch (err) {
      this.logger.error(`Dedup store error for key ${key}: ${(err as Error).message}`);
      // On Redis failure, allow processing to avoid silent data loss
      return true;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async appendHistory(
    dispatchId: string,
    status: DispatchStatus,
    note?: string,
  ): Promise<void> {
    await this.historyRepo.save(
      this.historyRepo.create({ dispatchId, status, note: note ?? null }),
    );
  }

  private async transitionStatus(
    dispatch: DispatchRecord,
    target: DispatchStatus,
    note?: string,
  ): Promise<DispatchRecord> {
    const allowed = ALLOWED_TRANSITIONS[dispatch.status];
    if (!allowed.includes(target)) {
      throw new UnprocessableEntityException(
        `Cannot transition dispatch from ${dispatch.status} to ${target}`,
      );
    }
    dispatch.status = target;
    const saved = await this.dispatchRepo.save(dispatch);
    await this.appendHistory(saved.id, target, note);
    return saved;
  }

  /**
   * Loads an order and enforces that it belongs to the caller's organization.
   * Throws 404 when the order does not exist and 403 on cross-tenant access.
   */
  private async loadOrderForActor(
    orderId: string,
    actor: DispatchActor,
  ): Promise<OrderEntity> {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const orderOrgId = (order as unknown as { organizationId?: string }).organizationId;
    if (actor.organizationId && orderOrgId && orderOrgId !== actor.organizationId) {
      throw new ForbiddenException('Order does not belong to your organization');
    }
    return order;
  }

  /**
   * Resolves the rider record for the caller from the database.
   * Access tokens carry no riderId, so the user id is used to look it up.
   */
  private async resolveCallerRiderId(actor: DispatchActor): Promise<string> {
    const riderId = actor.riderId ?? actor.id;
    const rider = await this.riderAssignmentService.findRiderById(riderId);
    if (!rider) {
      throw new NotFoundException(`Rider for user ${actor.id} not found`);
    }
    return rider.id;
  }

  // ---------------------------------------------------------------------------
  // CRUD (fixes #525)
  // ---------------------------------------------------------------------------

  async findAll() {
    const data = await this.dispatchRepo.find({ order: { createdAt: 'DESC' } });
    return { message: 'Dispatches retrieved successfully', data };
  }

  async findOne(id: string) {
    const dispatch = await this.dispatchRepo.findOne({
      where: { id },
      relations: ['history'],
    });
    if (!dispatch) throw new NotFoundException(`Dispatch ${id} not found`);
    return { message: 'Dispatch retrieved successfully', data: dispatch };
  }

  async create(dto: CreateDispatchDto) {
    const dispatch = this.dispatchRepo.create({
      orderId: dto.orderId,
      riderId: dto.riderId ?? null,
      status: DispatchStatus.PENDING,
    });
    const saved = await this.dispatchRepo.save(dispatch);
    await this.appendHistory(saved.id, DispatchStatus.PENDING, 'created');
    return { message: 'Dispatch created successfully', data: saved };
  }

  async update(id: string, dto: UpdateDispatchDto) {
    const { data: dispatch } = await this.findOne(id);
    if (dto.riderId !== undefined) {
      dispatch.riderId = dto.riderId;
      if (dispatch.status === DispatchStatus.PENDING) {
        await this.transitionStatus(dispatch, DispatchStatus.ASSIGNED, 'rider updated');
      } else {
        await this.dispatchRepo.save(dispatch);
      }
    }
    return { message: 'Dispatch updated successfully', data: dispatch };
  }

  async remove(id: string) {
    const { data: dispatch } = await this.findOne(id);
    await this.dispatchRepo.remove(dispatch);
    return { message: 'Dispatch deleted successfully', data: { id } };
  }

  async completeDispatch(dispatchId: string) {
    const { data: dispatch } = await this.findOne(dispatchId);
    const updated = await this.transitionStatus(dispatch, DispatchStatus.COMPLETED);
    return { message: 'Dispatch completed successfully', data: updated };
  }

  async cancelDispatch(dispatchId: string, reason: string) {
    const { data: dispatch } = await this.findOne(dispatchId);
    dispatch.cancelReason = reason;
    const updated = await this.transitionStatus(dispatch, DispatchStatus.CANCELLED, reason);
    return { message: 'Dispatch cancelled successfully', data: updated };
  }

  // ---------------------------------------------------------------------------
  // Assignment (fixes #1879)
  // ---------------------------------------------------------------------------

  async assignOrder(orderId: string, riderId: string, actor: DispatchActor) {
    await this.loadOrderForActor(orderId, actor);

    const rider = await this.riderAssignmentService.findRiderById(riderId);
    if (!rider) throw new NotFoundException(`Rider ${riderId} not found`);
    if (!rider.isAvailable) {
      throw new UnprocessableEntityException(`Rider ${riderId} is not available`);
    }

    this.eventEmitter.emit(
      'order.rider.assigned',
      new OrderRiderAssignedEvent(orderId, rider.id, new Date()),
    );

    return {
      message: 'Rider assigned successfully',
      data: { orderId, riderId: rider.id },
    };
  }

  async respondToAssignment(
    orderId: string,
    accepted: boolean,
    actor: DispatchActor,
  ) {
    await this.loadOrderForActor(orderId, actor);

    const riderId = await this.resolveCallerRiderId(actor);

    const dispatch = await this.dispatchRepo.findOne({ where: { orderId } });
    if (!dispatch) throw new NotFoundException(`Dispatch for order ${orderId} not found`);
    if (dispatch.riderId !== riderId) {
      throw new ForbiddenException('You can only respond to your own assignment');
    }

    if (accepted) {
      await this.transitionStatus(dispatch, DispatchStatus.ACCEPTED, 'rider accepted');
    } else {
      await this.transitionStatus(dispatch, DispatchStatus.REJECTED, 'rider rejected');
    }

    return {
      message: accepted ? 'Assignment accepted' : 'Assignment rejected',
      data: { orderId, riderId, accepted },
    };
  }

  // ---------------------------------------------------------------------------
  // Event handlers — now update DB records and append history (fixes #525 + #526)
  // ---------------------------------------------------------------------------

  @OnEvent('order.cancelled')
  async handleOrderCancelled(event: OrderCancelledEvent) {
    const key = this.dedupKey('order.cancelled', event.orderId, event.timestamp);
    if (!(await this.acquireDedup(key))) {
      this.logger.warn(`Duplicate event skipped: ${key}`);
      return;
    }

    this.logger.log(`Handling order.cancelled for order ${event.orderId}`);

    const dispatch = await this.dispatchRepo.findOne({ where: { orderId: event.orderId } });
    if (!dispatch) return;

    const allowed = ALLOWED_TRANSITIONS[dispatch.status];
    if (!allowed.includes(DispatchStatus.CANCELLED)) {
      this.logger.warn(
        `Cannot cancel dispatch ${dispatch.id} in status ${dispatch.status}`,
      );
      return;
    }

    dispatch.cancelReason = event.reason;
    dispatch.status = DispatchStatus.CANCELLED;
    await this.dispatchRepo.save(dispatch);
    await this.appendHistory(dispatch.id, DispatchStatus.CANCELLED, event.reason);
  }

  @OnEvent('order.status.updated')
  async handleOrderStatusUpdated(event: OrderStatusUpdatedEvent) {
    const key = this.dedupKey('order.status.updated', event.orderId, event.timestamp);
    if (!(await this.acquireDedup(key))) {
      this.logger.warn(`Duplicate event skipped: ${key}`);
      return;
    }

    this.logger.log(
      `Handling order.status.updated for order ${event.orderId} -> ${event.status}`,
    );

    const dispatch = await this.dispatchRepo.findOne({ where: { orderId: event.orderId } });
    if (!dispatch) return;

    if (event.status === OrderStatus.CANCELLED) {
      const allowed = ALLOWED_TRANSITIONS[dispatch.status];
      if (allowed.includes(DispatchStatus.CANCELLED)) {
        dispatch.status = DispatchStatus.CANCELLED;
        await this.dispatchRepo.save(dispatch);
        await this.appendHistory(dispatch.id, DispatchStatus.CANCELLED, 'order cancelled');
      }
    }
  }

  @OnEvent('cold-chain.breach')
  async handleColdChainBreach(event: ColdChainBreachEvent) {
    this.logger.warn(`Cold chain breach for order ${event.orderId}`);
    const dispatch = await this.dispatchRepo.findOne({ where: { orderId: event.orderId } });
    if (!dispatch) return;
    await this.notificationsService.send({
      channel: NotificationChannel.IN_APP,
      recipientId: dispatch.riderId ?? '',
      title: 'Cold chain breach',
      body: `Cold chain breach detected for order ${event.orderId}`,
    });
  }
}
