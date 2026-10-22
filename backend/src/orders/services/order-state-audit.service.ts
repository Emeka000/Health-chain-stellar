import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OrderEntity } from '../entities/order.entity';
import { OrderStatus } from '../enums/order-status.enum';
import { OrderEventStoreService } from './order-event-store.service';
import { OrderStateMachine, TERMINAL_STATES, VALID_TRANSITIONS } from '../state-machine/order-state-machine';

export interface AuditResult {
  orderId: string;
  materializedStatus: OrderStatus;
  replayedStatus: OrderStatus | null;
  consistent: boolean;
  /** True when the materialized status is not reachable via any valid path. */
  invalidState: boolean;
  quarantined: boolean;
  reason?: string;
}

@Injectable()
export class OrderStateAuditService {
  private readonly logger = new Logger(OrderStateAuditService.name);

  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly eventStore: OrderEventStoreService,
    private readonly stateMachine: OrderStateMachine,
  ) {}

  /**
   * Audit all orders: compare materialized status against event-store replay.
   * Returns a list of inconsistent or invalid-state orders (Issue #617).
   */
  async auditAll(): Promise<AuditResult[]> {
    const orders = await this.orderRepo.find();
    const results: AuditResult[] = [];

    for (const order of orders) {
      const result = await this.auditOrder(order);
      if (!result.consistent || result.invalidState) {
        results.push(result);
        this.logger.warn(
          `Order audit issue: orderId=${order.id} materialized=${order.status} replayed=${result.replayedStatus} consistent=${result.consistent} invalidState=${result.invalidState}`,
        );
      }
    }

    return results;
  }

  /**
   * Audit a single order and optionally quarantine it if inconsistent.
   */
  async auditOrder(order: OrderEntity): Promise<AuditResult> {
    let replayedStatus: OrderStatus | null = null;
    let consistent = true;
    let reason: string | undefined;

    try {
      replayedStatus = await this.eventStore.replayOrderState(order.id);
      consistent = replayedStatus === order.status;
      if (!consistent) {
        reason = `Materialized '${order.status}' differs from replayed '${replayedStatus}'`;
      }
    } catch (err) {
      consistent = false;
      reason = `Event replay failed: ${(err as Error).message}`;
    }

    const invalidState = !this.isReachableState(order.status);

    return {
      orderId: order.id,
      materializedStatus: order.status,
      replayedStatus,
      consistent,
      invalidState,
      quarantined: false,
      reason,
    };
  }

  /**
   * Check whether a status value is reachable via any valid transition path
   * (i.e. it appears as a value in VALID_TRANSITIONS or is PENDING).
   */
  private isReachableState(status: OrderStatus): boolean {
    if (status === OrderStatus.PENDING) return true;
    for (const targets of Object.values(VALID_TRANSITIONS)) {
      if ((targets as OrderStatus[]).includes(status)) return true;
    }
    return false;
  }
}
