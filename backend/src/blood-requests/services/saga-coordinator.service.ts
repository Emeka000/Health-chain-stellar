import { randomUUID } from 'crypto';

import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InventoryService } from '../../inventory/inventory.service';
import {
  BloodRequestSagaEntity,
  SagaCompensationReason,
  SagaState,
} from '../entities/blood-request-saga.entity';

export interface SagaStartOptions {
  requestId: string;
  correlationId?: string;
  timeoutMs?: number;
  context?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const STATE_ORDER = [
  SagaState.STARTED,
  SagaState.INVENTORY_RESERVED,
  SagaState.APPROVED,
  SagaState.DISPATCHED,
  SagaState.IN_TRANSIT,
  SagaState.SETTLED,
];
const TERMINAL = [SagaState.SETTLED, SagaState.CANCELLED, SagaState.COMPENSATION_FAILED];

/**
 * Durable saga coordinator for blood request fulfillment.
 * State: STARTED → INVENTORY_RESERVED → APPROVED → DISPATCHED → IN_TRANSIT → SETTLED
 * Failures trigger deterministic compensation in reverse order.
 * Optimistic locking (VersionColumn) prevents concurrent step execution.
 */
@Injectable()
export class SagaCoordinatorService {
  private readonly logger = new Logger(SagaCoordinatorService.name);

  constructor(
    @InjectRepository(BloodRequestSagaEntity)
    private readonly sagaRepo: Repository<BloodRequestSagaEntity>,
    private readonly inventoryService: InventoryService,
  ) {}

  async start(opts: SagaStartOptions): Promise<BloodRequestSagaEntity> {
    const existing = await this.sagaRepo.findOne({ where: { requestId: opts.requestId } });
    if (existing) return existing; // idempotent

    const saga = this.sagaRepo.create({
      requestId: opts.requestId,
      correlationId: opts.correlationId ?? randomUUID(),
      state: SagaState.STARTED,
      compensationLog: [],
      compensationReason: null,
      context: opts.context ?? {},
      timeoutAt: new Date(Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)),
      retryCount: 0,
      lastError: null,
    });
    const saved = await this.sagaRepo.save(saga);
    this.logger.log(`Saga started requestId=${opts.requestId} correlationId=${saved.correlationId}`);
    return saved;
  }

  /**
   * Advance saga to next state with optimistic locking.
   * Throws ConflictException on concurrent modification.
   */
  async advance(
    requestId: string,
    toState: SagaState,
    contextPatch?: Record<string, unknown>,
  ): Promise<BloodRequestSagaEntity> {
    const saga = await this.findOrThrow(requestId);
    if (TERMINAL.includes(saga.state)) {
      throw new ConflictException(`Saga ${requestId} is in terminal state ${saga.state}`);
    }

    const result = await this.sagaRepo
      .createQueryBuilder()
      .update(BloodRequestSagaEntity)
      .set({ state: toState, context: { ...saga.context, ...(contextPatch ?? {}) }, lastError: null })
      .where('request_id = :requestId', { requestId })
      .andWhere('version = :version', { version: saga.version })
      .execute();

    if (!result.affected) {
      throw new ConflictException(`Saga ${requestId} modified concurrently — retry`);
    }
    this.logger.log(`Saga ${requestId}: ${saga.state} → ${toState} correlationId=${saga.correlationId}`);
    return this.findOrThrow(requestId);
  }

  /**
   * Trigger deterministic compensation. Idempotent — already-applied steps are skipped.
   */
  async compensate(
    requestId: string,
    reason: SagaCompensationReason,
    error: string,
  ): Promise<BloodRequestSagaEntity> {
    const saga = await this.findOrThrow(requestId);
    if (saga.state === SagaState.CANCELLED || saga.state === SagaState.COMPENSATION_FAILED) {
      return saga;
    }

    await this.sagaRepo.update({ requestId }, { state: SagaState.COMPENSATING, compensationReason: reason, lastError: error });

    const log = [...saga.compensationLog];
    try {
      if (this.wasStepReached(saga, SagaState.INVENTORY_RESERVED) && !this.wasCompensated(log, 'release_inventory')) {
        const reserved = saga.context.reservedItems as Array<{ bloodBankId: string; bloodType: string; quantity: number }> | undefined;
        for (const item of [...(reserved ?? [])].reverse()) {
          await this.inventoryService.releaseStockByBankAndType(item.bloodBankId, item.bloodType, item.quantity);
        }
        log.push({ step: 'release_inventory', appliedAt: new Date().toISOString(), success: true });
      }
      await this.sagaRepo.update({ requestId }, { state: SagaState.CANCELLED, compensationLog: log });
      this.logger.log(`Saga compensated requestId=${requestId} reason=${reason}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push({ step: 'release_inventory', appliedAt: new Date().toISOString(), success: false });
      await this.sagaRepo.update({ requestId }, { state: SagaState.COMPENSATION_FAILED, compensationLog: log, lastError: msg });
      this.logger.error(`Saga compensation failed requestId=${requestId}: ${msg}`);
    }
    return this.findOrThrow(requestId);
  }

  async findByRequestId(requestId: string): Promise<BloodRequestSagaEntity | null> {
    return this.sagaRepo.findOne({ where: { requestId } });
  }

  async findByCorrelationId(correlationId: string): Promise<BloodRequestSagaEntity | null> {
    return this.sagaRepo.findOne({ where: { correlationId } });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async escalateTimedOutSagas(): Promise<void> {
    const timedOut = await this.sagaRepo
      .createQueryBuilder('s')
      .where('s.timeout_at < :now', { now: new Date() })
      .andWhere('s.state NOT IN (:...terminal)', { terminal: TERMINAL })
      .getMany();

    for (const saga of timedOut) {
      this.logger.warn(`Saga timed out requestId=${saga.requestId} state=${saga.state}`);
      await this.compensate(saga.requestId, SagaCompensationReason.TIMEOUT,
        `Exceeded timeout at ${saga.timeoutAt?.toISOString()}`);
    }
  }

  private async findOrThrow(requestId: string): Promise<BloodRequestSagaEntity> {
    const saga = await this.sagaRepo.findOne({ where: { requestId } });
    if (!saga) throw new NotFoundException(`Saga for request '${requestId}' not found`);
    return saga;
  }

  private wasStepReached(saga: BloodRequestSagaEntity, step: SagaState): boolean {
    return STATE_ORDER.indexOf(saga.state) >= STATE_ORDER.indexOf(step);
  }

  private wasCompensated(log: BloodRequestSagaEntity['compensationLog'], step: string): boolean {
    return log.some((e) => e.step === step && e.success);
  }
}
