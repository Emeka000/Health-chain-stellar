import {
  Injectable,
  Logger,
  NotFoundException,
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
      `Handling order.status.updated: ${event.orderId} ${event.previousStatus} → ${event.newStatus}`,
    );

    const dispatch = await this.dispatchRepo.findOne({ where: { orderId: event.orderId } });
    if (!dispatch) return;

    // Map order status to dispatch status where applicable
    const statusMap: Partial<Record<OrderStatus, DispatchStatus>> = {
      [OrderStatus.DISPATCHED]: DispatchStatus.ASSIGNED,
      [OrderStatus.IN_TRANSIT]: DispatchStatus.IN_TRANSIT,
      [OrderStatus.DELIVERED]: DispatchStatus.COMPLETED,
      [OrderStatus.CANCELLED]: DispatchStatus.CANCELLED,
    };

    const target = statusMap[event.newStatus as OrderStatus];
    if (!target) return;

    const allowed = ALLOWED_TRANSITIONS[dispatch.status];
    if (!allowed.includes(target)) return;

    dispatch.status = target;
    await this.dispatchRepo.save(dispatch);
    await this.appendHistory(
      dispatch.id,
      target,
      `order status changed to ${event.newStatus}`,
    );
  }

  @OnEvent('order.rider.assigned')
  async handleOrderRiderAssigned(event: OrderRiderAssignedEvent) {
    const key = this.dedupKey('order.rider.assigned', event.orderId, event.timestamp);
    if (!(await this.acquireDedup(key))) {
      this.logger.warn(`Duplicate event skipped: ${key}`);
      return;
    }

    this.logger.log(
      `Handling order.rider.assigned: rider ${event.riderId} → order ${event.orderId}`,
    );

    let dispatch = await this.dispatchRepo.findOne({ where: { orderId: event.orderId } });
    if (!dispatch) {
      dispatch = this.dispatchRepo.create({
        orderId: event.orderId,
        riderId: event.riderId,
        status: DispatchStatus.PENDING,
      });
      await this.dispatchRepo.save(dispatch);
      await this.appendHistory(dispatch.id, DispatchStatus.PENDING, 'auto-created on rider assignment');
    }

    const allowed = ALLOWED_TRANSITIONS[dispatch.status];
    if (!allowed.includes(DispatchStatus.ASSIGNED)) return;

    dispatch.riderId = event.riderId;
    dispatch.status = DispatchStatus.ASSIGNED;
    await this.dispatchRepo.save(dispatch);
    await this.appendHistory(dispatch.id, DispatchStatus.ASSIGNED, `rider ${event.riderId} assigned`);
  }

  @OnEvent('cold-chain.breach')
  async handleColdChainBreach(event: ColdChainBreachEvent): Promise<void> {
    this.logger.warn(
      `Cold-chain breach for delivery ${event.deliveryId}: ` +
        `${event.breachDurationMinutes.toFixed(1)} min outside 2–8 °C`,
    );

    if (event.orderId) {
      await this.orderRepo.update(event.orderId, { status: OrderStatus.CANCELLED });

      const order = await this.orderRepo.findOne({ where: { id: event.orderId } });
      if (order) {
        await this.bloodUnitRepo
          .createQueryBuilder()
          .update()
          .set({ status: BloodStatus.QUARANTINED })
          .where('reservedFor = :orderId', { orderId: event.orderId })
          .execute();

        const notifyIds = [order.hospitalId, order.bloodBankId].filter(Boolean) as string[];
        for (const recipientId of notifyIds) {
          await this.notificationsService
            .send({
              recipientId,
              channels: [NotificationChannel.EMAIL],
              templateKey: 'cold_chain_breach',
              variables: {
                deliveryId: event.deliveryId,
                orderId: event.orderId ?? '',
                breachDurationMinutes: String(event.breachDurationMinutes.toFixed(1)),
                minTempCelsius: String(event.minTempCelsius),
                maxTempCelsius: String(event.maxTempCelsius),
                breachStartedAt: event.breachStartedAt.toISOString(),
              },
            })
            .catch((e) =>
              this.logger.warn(
                `Breach notification failed for ${recipientId}: ${(e as Error).message}`,
              ),
            );
        }
      }
    }

    try {
      await this.riderAssignmentService.reassign(event.orderId ?? event.deliveryId);
    } catch (err) {
      this.logger.error(
        `Rider reassignment failed for delivery ${event.deliveryId}: ${(err as Error).message}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Delegation to RiderAssignmentService
  // ---------------------------------------------------------------------------

  async assignOrder(orderId: string, riderId: string) {
    this.eventEmitter.emit('order.rider.assigned', new OrderRiderAssignedEvent(orderId, riderId));
    return { message: 'Order assigned to rider successfully', data: { orderId, riderId } };
  }

  getDispatchStats() {
    return this.riderAssignmentService.getDispatchStats();
  }

  async getAssignmentLogs(orderId?: string) {
    return this.riderAssignmentService.getAssignmentLogs(orderId);
  }

  async respondToAssignment(orderId: string, riderId: string, accepted: boolean) {
    return this.riderAssignmentService.respondToAssignment(orderId, riderId, accepted);
  }
}
