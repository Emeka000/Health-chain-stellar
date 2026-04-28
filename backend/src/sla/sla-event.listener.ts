import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  OrderConfirmedEvent,
  OrderDispatchedEvent,
  OrderInTransitEvent,
  OrderDeliveredEvent,
} from '../events';
import { OrderEntity } from '../orders/entities/order.entity';
import { SlaService } from './sla.service';
import { SlaStage } from './enums/sla-stage.enum';

/**
 * Listens to order lifecycle events and advances SLA stage clocks.
 *
 * Stage mapping:
 *   order created       → start TRIAGE
 *   order.confirmed     → complete TRIAGE, start MATCHING
 *   order.dispatched    → complete MATCHING + DISPATCH_ACCEPTANCE, start PICKUP
 *   order.in_transit    → complete PICKUP, start DELIVERY
 *   order.delivered     → complete DELIVERY
 */
@Injectable()
export class SlaEventListener {
  private readonly logger = new Logger(SlaEventListener.name);

  constructor(
    private readonly slaService: SlaService,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
  ) {}

  @OnEvent('order.confirmed')
  async onConfirmed(event: OrderConfirmedEvent) {
    await this.safe(async () => {
      const order = await this.orderRepo.findOne({ where: { id: event.orderId } });
      if (!order) return;
      await this.slaService.completeStage(event.orderId, SlaStage.TRIAGE);
      await this.slaService.startStage(event.orderId, SlaStage.MATCHING, {
        hospitalId: order.hospitalId,
        bloodBankId: order.bloodBankId ?? undefined,
      });
    }, event.orderId, 'confirmed');
  }

  @OnEvent('order.dispatched')
  async onDispatched(event: OrderDispatchedEvent) {
    await this.safe(async () => {
      const order = await this.orderRepo.findOne({ where: { id: event.orderId } });
      if (!order) return;
      const ctx = {
        hospitalId: order.hospitalId,
        bloodBankId: order.bloodBankId ?? undefined,
        riderId: event.riderId,
      };
      await this.slaService.completeStage(event.orderId, SlaStage.MATCHING);
      await this.slaService.completeStage(event.orderId, SlaStage.DISPATCH_ACCEPTANCE);
      await this.slaService.startStage(event.orderId, SlaStage.PICKUP, ctx);
    }, event.orderId, 'dispatched');
  }

  @OnEvent('order.in_transit')
  async onInTransit(event: OrderInTransitEvent) {
    await this.safe(async () => {
      const order = await this.orderRepo.findOne({ where: { id: event.orderId } });
      if (!order) return;
      await this.slaService.completeStage(event.orderId, SlaStage.PICKUP);
      await this.slaService.startStage(event.orderId, SlaStage.DELIVERY, {
        hospitalId: order.hospitalId,
        bloodBankId: order.bloodBankId ?? undefined,
        riderId: order.riderId ?? undefined,
      });
    }, event.orderId, 'in_transit');
  }

  @OnEvent('order.delivered')
  async onDelivered(event: OrderDeliveredEvent) {
    await this.safe(async () => {
      await this.slaService.completeStage(event.orderId, SlaStage.DELIVERY);
    }, event.orderId, 'delivered');
  }

  private async safe(fn: () => Promise<void>, orderId: string, event: string) {
    try {
      await fn();
    } catch (err: unknown) {
      this.logger.error(`SLA update failed for order ${orderId} on event '${event}': ${(err as Error).message}`);
    }
  }
}
