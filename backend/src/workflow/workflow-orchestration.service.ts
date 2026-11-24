import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { SorobanService } from '../blockchain/services/soroban.service';
import { OrderEntity } from '../orders/entities/order.entity';
import { OrderStatus } from '../orders/enums/order-status.enum';
import {
  ActorRegistryService,
  ActorType,
} from '../registry/actor-registry.service';

export type WorkflowStep =
  | 'allocate'
  | 'confirm_delivery'
  | 'settle'
  | 'rollback';

@Injectable()
export class WorkflowOrchestrationService {
  private readonly logger = new Logger(WorkflowOrchestrationService.name);

  private get coordinatorContract(): string {
    return this.config.get<string>('COORDINATOR_CONTRACT_ID', '');
  }

  /**
   * The coordinator contract requires its configured admin to sign every
   * state-changing call. End users never sign these transactions directly.
   */
  private get coordinatorAdminAddress(): string {
    const admin = this.config.get<string>('COORDINATOR_ADMIN_ADDRESS', '');
    if (!admin) {
      throw new InternalServerErrorException(
        'COORDINATOR_ADMIN_ADDRESS is not configured',
      );
    }
    return admin;
  }

  constructor(
    private readonly soroban: SorobanService,
    private readonly config: ConfigService,
    private readonly actorRegistry: ActorRegistryService,
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
    const order = await this.orderRepo.findOne({
      where: { id: params.requestId },
    });
    if (!order)
      throw new BadRequestException(`Order ${params.requestId} not found`);
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        `Order must be PENDING to allocate units, current status: ${order.status}`,
      );
    }

    // Verify the caller is a registered hospital or blood bank before the on-chain write
    await this.assertCallerIsRegisteredActor(params.callerAddress);

    const onChainRequestId = this.requireOnChainId(
      order.onChainRequestId,
      'onChainRequestId',
      params.requestId,
    );
    const onChainPaymentId = this.requireOnChainId(
      order.onChainPaymentId,
      'onChainPaymentId',
      params.requestId,
    );
    const onChainUnitIds = this.toOnChainUnitIds(params.unitIds);

    const jobId = await this.soroban.submitTransaction({
      contractMethod: 'allocate_units',
      args: [
        onChainRequestId,
        onChainUnitIds,
        onChainPaymentId,
        this.coordinatorAdminAddress,
      ],
      idempotencyKey: this.attemptKey('allocate', params.requestId, order),
      metadata: { contractId: this.coordinatorContract },
    });

    this.logger.log(
      `Allocation queued for request ${params.requestId}, job ${jobId}`,
    );
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
    const order = await this.orderRepo.findOne({
      where: { id: params.requestId },
    });
    if (!order)
      throw new BadRequestException(`Order ${params.requestId} not found`);
    if (
      order.status !== OrderStatus.IN_TRANSIT &&
      order.status !== OrderStatus.DISPATCHED
    ) {
      throw new BadRequestException(
        `Order must be IN_TRANSIT or DISPATCHED to confirm delivery, current: ${order.status}`,
      );
    }

    // Verify the caller is a registered actor before the on-chain write
    await this.assertCallerIsRegisteredActor(params.callerAddress);

    const onChainRequestId = this.requireOnChainId(
      order.onChainRequestId,
      'onChainRequestId',
      params.requestId,
    );

    const jobId = await this.soroban.submitTransaction({
      contractMethod: 'confirm_delivery',
      args: [onChainRequestId, this.coordinatorAdminAddress],
      idempotencyKey: this.attemptKey('delivery', params.requestId, order),
      metadata: { contractId: this.coordinatorContract },
    });

    this.logger.log(
      `Delivery confirmation queued for request ${params.requestId}, job ${jobId}`,
    );
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
    const order = await this.orderRepo.findOne({
      where: { id: params.requestId },
    });
    if (!order)
      throw new BadRequestException(`Order ${params.requestId} not found`);
    if (order.status !== OrderStatus.DELIVERED) {
      throw new BadRequestException(
        `Order must be DELIVERED to settle payment, current: ${order.status}`,
      );
    }

    // Verify the caller is a registered actor before the financial settlement write
    await this.assertCallerIsRegisteredActor(params.callerAddress);

    const onChainRequestId = this.requireOnChainId(
      order.onChainRequestId,
      'onChainRequestId',
      params.requestId,
    );

    const jobId = await this.soroban.submitTransaction({
      contractMethod: 'settle_payment',
      args: [onChainRequestId, this.coordinatorAdminAddress],
      idempotencyKey: this.attemptKey('settle', params.requestId, order),
      metadata: { contractId: this.coordinatorContract },
    });

    this.logger.log(
      `Settlement queued for request ${params.requestId}, job ${jobId}`,
    );
    return { jobId };
  }

  /**
   * Rollback – admin-only. Releases units and refunds payment on-chain.
   * Only allowed for orders in PENDING, CONFIRMED, DISPATCHED, or IN_TRANSIT status.
   */
  async rollback(params: { requestId: string }): Promise<{ jobId: string }> {
    const order = await this.orderRepo.findOne({
      where: { id: params.requestId },
    });
    if (!order)
      throw new BadRequestException(`Order ${params.requestId} not found`);
    const rollbackableStatuses = [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.DISPATCHED,
      OrderStatus.IN_TRANSIT,
    ];
    if (!rollbackableStatuses.includes(order.status)) {
      throw new BadRequestException(
        `Cannot rollback order with status ${order.status}. Allowed: ${rollbackableStatuses.join(', ')}`,
      );
    }

    const onChainRequestId = this.requireOnChainId(
      order.onChainRequestId,
      'onChainRequestId',
      params.requestId,
    );

    const jobId = await this.soroban.submitTransaction({
      contractMethod: 'rollback',
      args: [onChainRequestId],
      idempotencyKey: this.attemptKey('rollback', params.requestId, order),
      metadata: { contractId: this.coordinatorContract },
    });

    this.logger.log(
      `Rollback queued for request ${params.requestId}, job ${jobId}`,
    );
    return { jobId };
  }

  /**
   * Returns the persisted on-chain (u64) identifier for an order, failing
   * loudly if the off-chain record was never mapped to an on-chain ID.
   */
  private requireOnChainId(
    value: string | number | null | undefined,
    field: string,
    requestId: string,
  ): number {
    if (value === null || value === undefined || value === '') {
      throw new BadRequestException(
        `Order ${requestId} has no ${field}; it must be created on-chain first`,
      );
    }
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new BadRequestException(
        `Order ${requestId} has an invalid ${field}: ${String(value)}`,
      );
    }
    return parsed;
  }

  /**
   * Converts the off-chain unit identifiers into the numeric (u64) IDs the
   * coordinator contract expects.
   */
  private toOnChainUnitIds(unitIds: string[]): number[] {
    if (!Array.isArray(unitIds) || unitIds.length === 0) {
      throw new BadRequestException('At least one unit ID is required');
    }
    return unitIds.map((unitId) => {
      const parsed = Number(unitId);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new BadRequestException(
          `Unit ID '${unitId}' is not a valid on-chain unit ID`,
        );
      }
      return parsed;
    });
  }

  /**
   * Builds an idempotency key scoped to the current allocation attempt so that
   * a rollback (which bumps the attempt) releases the previous key and the
   * request can be re-allocated.
   */
  private attemptKey(
    step: WorkflowStep,
    requestId: string,
    order: OrderEntity,
  ): string {
    const attempt = order.allocationAttempt ?? 0;
    return `${step}:${requestId}:${attempt}`;
  }

  /**
   * Verifies that a caller address belongs to a registered hospital or blood bank.
   * Called before every sensitive on-chain write in this service.
   */
  private async assertCallerIsRegisteredActor(
    callerAddress: string,
  ): Promise<void> {
    const [isHospital, isBloodBank] = await Promise.all([
      this.actorRegistry.isVerifiedActor(callerAddress, ActorType.HOSPITAL),
      this.actorRegistry.isVerifiedActor(callerAddress, ActorType.BLOOD_BANK),
    ]);

    if (!isHospital && !isBloodBank) {
      throw new ForbiddenException(
        `Caller '${callerAddress}' is not a verified hospital or blood bank in the registry.`,
      );
    }
  }
}
