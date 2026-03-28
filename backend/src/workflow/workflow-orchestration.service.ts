import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { SorobanService } from '../blockchain/services/soroban.service';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/enums/order-status.enum';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

export type WorkflowStep = 'allocate' | 'confirm_delivery' | 'settle' | 'rollback';

@Injectable()
export class WorkflowOrchestrationService {
  private readonly logger = new Logger(WorkflowOrchestrationService.name);

  private get coordinatorContract(): string {
    return this.config.get<string>('COORDINATOR_CONTRACT_ID', '');
  }

  constructor(
    private readonly soroban: SorobanService,
    private readonly config: ConfigService,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
  ) {}

  /**
   * Step 1 – Allocate inventory units to a request on-chain.
   * Validates order is PENDING before submitting.
   */
  async allocateUnits(params: {
    requestId: string;
    unitIds: string[];
    paymentId: string;
    callerAddress: string;
  }): Promise<{ jobId: string }> {
    const order = await this.orderRepo.findOne({ where: { id: params.requestId } });
    if (!order) throw new BadRequestException(`Order ${params.requestId} not found`);
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        `Order must be PENDING to allocate units, current status: ${order.status}`,
      );
    }

    const jobId = await this.soroban.submitTransaction({
      contractMethod: 'allocate_units',
      args: [
        params.requestId,
        params.unitIds,
        params.paymentId,
        params.callerAddress,
      ],
      idempotencyKey: `allocate:${params.requestId}`,
      metadata: { contractId: this.coordinatorContract },
    });

    this.logger.log(`Allocation queued for request ${params.requestId}, job ${jobId}`);
    return { jobId };
  }

  /**
   * Step 2 – Confirm delivery on-chain.
   * Validates order is DISPATCHED/IN_TRANSIT before submitting.
   */
  async confirmDelivery(params: {
    requestId: string;
    callerAddress: string;
  }): Promise<{ jobId: string }> {
    const order = await this.orderRepo.findOne({ where: { id: params.requestId } });
    if (!order) throw new BadRequestException(`Order ${params.requestId} not found`);
    if (
      order.status !== OrderStatus.IN_TRANSIT &&
      order.status !== OrderStatus.DISPATCHED
    ) {
      throw new BadRequestException(
        `Order must be IN_TRANSIT or DISPATCHED to confirm delivery, current: ${order.status}`,
      );
    }

    const jobId = await this.soroban.submitTransaction({
      contractMethod: 'confirm_delivery',
      args: [params.requestId, params.callerAddress],
      idempotencyKey: `delivery:${params.requestId}`,
      metadata: { contractId: this.coordinatorContract },
    });

    this.logger.log(`Delivery confirmation queued for request ${params.requestId}, job ${jobId}`);
    return { jobId };
  }

  /**
   * Step 3 – Settle payment on-chain.
   * Validates order is DELIVERED before submitting.
   * The coordinator contract will reject if delivery is not confirmed on-chain.
   */
  async settlePayment(params: {
    requestId: string;
    callerAddress: string;
  }): Promise<{ jobId: string }> {
    const order = await this.orderRepo.findOne({ where: { id: params.requestId } });
    if (!order) throw new BadRequestException(`Order ${params.requestId} not found`);
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException(
        `Order must be DELIVERED to settle payment, current: ${order.status}`,
      );
    }

    const jobId = await this.soroban.submitTransaction({
      contractMethod: 'settle_payment',
      args: [params.requestId, params.callerAddress],
      idempotencyKey: `settle:${params.requestId}`,
      metadata: { contractId: this.coordinatorContract },
    });

    this.logger.log(`Settlement queued for request ${params.requestId}, job ${jobId}`);
    return { jobId };
  }

  /**
   * Rollback – admin-only. Releases units and refunds payment on-chain.
   */
  async rollback(params: {
    requestId: string;
  }): Promise<{ jobId: string }> {
    const jobId = await this.soroban.submitTransaction({
      contractMethod: 'rollback',
      args: [params.requestId],
      idempotencyKey: `rollback:${params.requestId}:${Date.now()}`,
      metadata: { contractId: this.coordinatorContract },
    });

    this.logger.log(`Rollback queued for request ${params.requestId}, job ${jobId}`);
    return { jobId };
  }
}
