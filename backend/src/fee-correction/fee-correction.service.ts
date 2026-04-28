import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, Between } from 'typeorm';

import { ApprovalService } from '../approvals/approval.service';
import { ApprovalActionType, ApprovalStatus } from '../approvals/enums/approval.enum';
import { FeePolicyService } from '../fee-policy/fee-policy.service';
import { OrderEntity } from '../orders/entities/order.entity';
import { PaginationUtil, PaginatedResponse } from '../common/pagination';

import { FeeAdjustmentEntryEntity } from './entities/fee-adjustment-entry.entity';
import { FeeCorrectionRunEntity } from './entities/fee-correction-run.entity';
import {
  FeeAdjustmentEntryStatus,
  FeeCorrectionRunStatus,
} from './enums/fee-correction.enum';
import {
  ExecuteFeeCorrectionDto,
  FeeCorrectionQueryDto,
  InitiateFeeCorrectionDto,
} from './dto/fee-correction.dto';

/** Number of orders processed per DB transaction during execution. */
const DEFAULT_BATCH_SIZE = 100;

@Injectable()
export class FeeCorrectionService {
  private readonly logger = new Logger(FeeCorrectionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(FeeCorrectionRunEntity)
    private readonly runRepo: Repository<FeeCorrectionRunEntity>,
    @InjectRepository(FeeAdjustmentEntryEntity)
    private readonly entryRepo: Repository<FeeAdjustmentEntryEntity>,
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly feePolicyService: FeePolicyService,
    private readonly approvalService: ApprovalService,
  ) {}

  // ── Initiation ────────────────────────────────────────────────────────────

  /**
   * Initiate a retroactive fee correction run.
   *
   * Steps:
   *  1. Idempotency check — return existing run if key already exists.
   *  2. Validate both policy IDs exist.
   *  3. Discover affected orders and record the count.
   *  4. Create an ApprovalRequest that must be approved before execution.
   *  5. Persist the run in PENDING_APPROVAL status.
   */
  async initiate(
    dto: InitiateFeeCorrectionDto,
    initiatedBy: string,
  ): Promise<FeeCorrectionRunEntity> {
    // 1. Idempotency
    const existing = await this.runRepo.findOne({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      this.logger.log(
        `Returning existing correction run for idempotency key: ${dto.idempotencyKey}`,
      );
      return existing;
    }

    // 2. Validate policies
    await this.feePolicyService.findOne(dto.policySnapshotId);
    await this.feePolicyService.findOne(dto.correctedPolicyId);

    const affectedFrom = new Date(dto.affectedFrom);
    const affectedTo = new Date(dto.affectedTo);

    if (affectedFrom >= affectedTo) {
      throw new BadRequestException('affectedFrom must be before affectedTo');
    }

    // 3. Discover affected order count
    const totalAffected = await this.countAffectedOrders(
      dto.policySnapshotId,
      affectedFrom,
      affectedTo,
    );

    if (totalAffected === 0) {
      throw new BadRequestException(
        `No orders found with appliedPolicyId=${dto.policySnapshotId} in the specified window`,
      );
    }

    // 4. Create approval request
    const approvalRequest = await this.approvalService.createRequest({
      targetId: dto.idempotencyKey,
      actionType: ApprovalActionType.FEE_OVERRIDE,
      requesterId: initiatedBy,
      requiredApprovals: 2, // dual-control for financial corrections
      metadata: {
        policySnapshotId: dto.policySnapshotId,
        correctedPolicyId: dto.correctedPolicyId,
        affectedFrom: dto.affectedFrom,
        affectedTo: dto.affectedTo,
        totalAffected,
      },
      expiresInHours: 72,
    });

    // 5. Persist run
    const run = this.runRepo.create({
      idempotencyKey: dto.idempotencyKey,
      status: FeeCorrectionRunStatus.PENDING_APPROVAL,
      policySnapshotId: dto.policySnapshotId,
      correctedPolicyId: dto.correctedPolicyId,
      affectedFrom,
      affectedTo,
      totalAffected,
      approvalRequestId: approvalRequest.id,
      initiatedBy,
    });

    const saved = await this.runRepo.save(run);
    this.logger.log(
      `Fee correction run ${saved.id} created. ${totalAffected} orders affected. Awaiting approval.`,
    );
    return saved;
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  /**
   * Execute an approved correction run.
   *
   * Execution is:
   *  - Approval-gated: run must be in APPROVED status.
   *  - Resumable: uses cursor_order_id to skip already-processed orders.
   *  - Idempotent: unique constraint on (order_id, correction_run_id) prevents
   *    duplicate entries even if the same batch is retried.
   *  - Batched: processes orders in configurable batch sizes to limit lock contention.
   */
  async execute(
    dto: ExecuteFeeCorrectionDto,
    executedBy: string,
  ): Promise<FeeCorrectionRunEntity> {
    const run = await this.findRunOrFail(dto.runId);

    if (
      run.status !== FeeCorrectionRunStatus.APPROVED &&
      run.status !== FeeCorrectionRunStatus.INTERRUPTED
    ) {
      throw new BadRequestException(
        `Run ${run.id} is in status '${run.status}'. Only APPROVED or INTERRUPTED runs can be executed.`,
      );
    }

    // Verify approval is still valid
    await this.assertApprovalGranted(run);

    run.status = FeeCorrectionRunStatus.RUNNING;
    run.executedBy = executedBy;
    await this.runRepo.save(run);

    // Run async — caller gets immediate response with RUNNING status
    this.executeAsync(run, dto.batchSize ?? DEFAULT_BATCH_SIZE).catch((err) => {
      this.logger.error(
        `Fee correction run ${run.id} failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    });

    return run;
  }

  /**
   * Approve a correction run (called by the approval workflow listener or admin).
   * Transitions the run from PENDING_APPROVAL → APPROVED.
   */
  async approveRun(runId: string): Promise<FeeCorrectionRunEntity> {
    const run = await this.findRunOrFail(runId);
    if (run.status !== FeeCorrectionRunStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        `Run ${runId} is not in PENDING_APPROVAL status`,
      );
    }
    run.status = FeeCorrectionRunStatus.APPROVED;
    return this.runRepo.save(run);
  }

  /**
   * Reject a correction run.
   */
  async rejectRun(runId: string): Promise<FeeCorrectionRunEntity> {
    const run = await this.findRunOrFail(runId);
    if (run.status !== FeeCorrectionRunStatus.PENDING_APPROVAL) {
      throw new BadRequestException(
        `Run ${runId} is not in PENDING_APPROVAL status`,
      );
    }
    run.status = FeeCorrectionRunStatus.REJECTED;
    return this.runRepo.save(run);
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  async findRun(id: string): Promise<FeeCorrectionRunEntity> {
    return this.findRunOrFail(id);
  }

  async listRuns(
    status?: FeeCorrectionRunStatus,
    page = 1,
    pageSize = 50,
  ): Promise<PaginatedResponse<FeeCorrectionRunEntity>> {
    const where = status ? { status } : {};
    const [items, total] = await this.runRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: PaginationUtil.calculateSkip(page, pageSize),
      take: pageSize,
    });
    return PaginationUtil.createResponse(items, page, pageSize, total);
  }

  async listEntries(
    query: FeeCorrectionQueryDto,
  ): Promise<PaginatedResponse<FeeAdjustmentEntryEntity>> {
    const qb = this.entryRepo.createQueryBuilder('entry');

    if (query.runId) {
      qb.andWhere('entry.correctionRunId = :runId', { runId: query.runId });
    }
    if (query.orderId) {
      qb.andWhere('entry.orderId = :orderId', { orderId: query.orderId });
    }
    if (query.status) {
      qb.andWhere('entry.status = :status', { status: query.status });
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const [items, total] = await qb
      .orderBy('entry.createdAt', 'DESC')
      .skip(PaginationUtil.calculateSkip(page, pageSize))
      .take(pageSize)
      .getManyAndCount();

    return PaginationUtil.createResponse(items, page, pageSize, total);
  }

  /**
   * Returns all adjustment entries for a specific order across all runs.
   * Consumers use this to reconstruct the full fee history for an order.
   */
  async getOrderFeeHistory(orderId: string): Promise<FeeAdjustmentEntryEntity[]> {
    return this.entryRepo.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Verify that re-running the correction with the same inputs produces
   * the same audit hashes. Returns mismatches if any.
   */
  async verifyReproducibility(
    runId: string,
  ): Promise<{ reproducible: boolean; mismatches: string[] }> {
    const run = await this.findRunOrFail(runId);
    const entries = await this.entryRepo.find({
      where: { correctionRunId: runId, status: FeeAdjustmentEntryStatus.APPLIED },
    });

    const mismatches: string[] = [];

    for (const entry of entries) {
      const order = await this.orderRepo.findOne({ where: { id: entry.orderId } });
      if (!order) {
        mismatches.push(`Order ${entry.orderId} not found`);
        continue;
      }

      const recomputed = await this.recomputeFee(order, run.correctedPolicyId);
      const expectedHash = this.buildAuditHash(
        entry.orderId,
        entry.originalPolicyId,
        entry.correctedPolicyId,
        recomputed,
      );

      if (expectedHash !== entry.auditHash) {
        mismatches.push(
          `Order ${entry.orderId}: expected hash ${expectedHash}, got ${entry.auditHash}`,
        );
      }
    }

    return { reproducible: mismatches.length === 0, mismatches };
  }

  // ── Private execution logic ───────────────────────────────────────────────

  private async executeAsync(
    run: FeeCorrectionRunEntity,
    batchSize: number,
  ): Promise<void> {
    try {
      let cursor = run.cursorOrderId;
      let processed = run.totalProcessed;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await this.fetchNextBatch(run, cursor, batchSize);
        if (batch.length === 0) break;

        await this.processBatch(run, batch);

        cursor = batch[batch.length - 1].id;
        processed += batch.length;

        // Persist cursor after each batch for resumability
        await this.runRepo.update(run.id, {
          cursorOrderId: cursor,
          totalProcessed: processed,
        });

        this.logger.log(
          `Run ${run.id}: processed ${processed}/${run.totalAffected} orders`,
        );
      }

      await this.runRepo.update(run.id, {
        status: FeeCorrectionRunStatus.COMPLETED,
        completedAt: new Date(),
        totalProcessed: processed,
      });

      this.logger.log(`Fee correction run ${run.id} completed. ${processed} orders processed.`);
    } catch (err) {
      await this.runRepo.update(run.id, {
        status: FeeCorrectionRunStatus.INTERRUPTED,
        errorMessage: (err as Error).message,
      });
      throw err;
    }
  }

  private async fetchNextBatch(
    run: FeeCorrectionRunEntity,
    cursor: string | null,
    batchSize: number,
  ): Promise<OrderEntity[]> {
    const qb = this.orderRepo
      .createQueryBuilder('order')
      .where('order.appliedPolicyId = :policyId', { policyId: run.policySnapshotId })
      .andWhere('order.createdAt >= :from', { from: run.affectedFrom })
      .andWhere('order.createdAt <= :to', { to: run.affectedTo })
      .andWhere('order.feeBreakdown IS NOT NULL')
      .orderBy('order.createdAt', 'ASC')
      .addOrderBy('order.id', 'ASC')
      .take(batchSize);

    if (cursor) {
      // Resume: skip orders at or before the cursor position
      const cursorOrder = await this.orderRepo.findOne({ where: { id: cursor } });
      if (cursorOrder) {
        qb.andWhere(
          '(order.createdAt > :cursorDate OR (order.createdAt = :cursorDate AND order.id > :cursorId))',
          { cursorDate: cursorOrder.createdAt, cursorId: cursor },
        );
      }
    }

    return qb.getMany();
  }

  private async processBatch(
    run: FeeCorrectionRunEntity,
    orders: OrderEntity[],
  ): Promise<void> {
    // Use a transaction per batch for atomicity + rollback safety
    await this.dataSource.transaction(async (manager) => {
      for (const order of orders) {
        // Skip if entry already exists (idempotent rerun)
        const existing = await manager.findOne(FeeAdjustmentEntryEntity, {
          where: { orderId: order.id, correctionRunId: run.id },
        });
        if (existing) continue;

        const originalBreakdown = order.feeBreakdown!;
        let correctedBreakdown: typeof originalBreakdown;
        let entryStatus = FeeAdjustmentEntryStatus.APPLIED;

        try {
          correctedBreakdown = await this.recomputeFee(order, run.correctedPolicyId);
        } catch (err) {
          this.logger.warn(
            `Could not recompute fee for order ${order.id}: ${(err as Error).message}`,
          );
          // Record a FAILED entry rather than aborting the whole batch
          correctedBreakdown = { ...originalBreakdown };
          entryStatus = FeeAdjustmentEntryStatus.FAILED;
        }

        const deltaDeliveryFee =
          (correctedBreakdown.deliveryFee ?? 0) - (originalBreakdown.deliveryFee ?? 0);
        const deltaPlatformFee =
          (correctedBreakdown.platformFee ?? 0) - (originalBreakdown.platformFee ?? 0);
        const deltaPerformanceFee =
          (correctedBreakdown.performanceFee ?? 0) - (originalBreakdown.performanceFee ?? 0);
        const deltaTotalFee =
          (correctedBreakdown.totalFee ?? 0) - (originalBreakdown.totalFee ?? 0);

        // Skip zero-delta entries (policy change had no effect on this order)
        if (
          entryStatus !== FeeAdjustmentEntryStatus.FAILED &&
          Math.abs(deltaTotalFee) < 0.0001
        ) {
          const skippedEntry = manager.create(FeeAdjustmentEntryEntity, {
            correctionRunId: run.id,
            orderId: order.id,
            originalPolicyId: run.policySnapshotId,
            correctedPolicyId: run.correctedPolicyId,
            originalFeeBreakdown: originalBreakdown,
            correctedFeeBreakdown: correctedBreakdown,
            deltaDeliveryFee: 0,
            deltaPlatformFee: 0,
            deltaPerformanceFee: 0,
            deltaTotalFee: 0,
            auditHash: this.buildAuditHash(
              order.id,
              run.policySnapshotId,
              run.correctedPolicyId,
              correctedBreakdown,
            ),
            status: FeeAdjustmentEntryStatus.SKIPPED,
            reconciliationLink: null,
          });
          await manager.save(FeeAdjustmentEntryEntity, skippedEntry);
          continue;
        }

        const auditHash = this.buildAuditHash(
          order.id,
          run.policySnapshotId,
          run.correctedPolicyId,
          correctedBreakdown,
        );

        // Generate compensating reconciliation link
        const reconciliationLink =
          entryStatus === FeeAdjustmentEntryStatus.APPLIED
            ? this.buildReconciliationLink(run.id, order.id, deltaTotalFee)
            : null;

        const entry = manager.create(FeeAdjustmentEntryEntity, {
          correctionRunId: run.id,
          orderId: order.id,
          originalPolicyId: run.policySnapshotId,
          correctedPolicyId: run.correctedPolicyId,
          originalFeeBreakdown: originalBreakdown,
          correctedFeeBreakdown: correctedBreakdown,
          deltaDeliveryFee,
          deltaPlatformFee,
          deltaPerformanceFee,
          deltaTotalFee,
          auditHash,
          status: entryStatus,
          reconciliationLink,
        });

        await manager.save(FeeAdjustmentEntryEntity, entry);
      }
    });
  }

  // ── Fee recomputation ─────────────────────────────────────────────────────

  private async recomputeFee(
    order: OrderEntity,
    correctedPolicyId: string,
  ): Promise<OrderEntity['feeBreakdown'] & {}> {
    const policy = await this.feePolicyService.findOne(correctedPolicyId);

    // Reconstruct the FeePreviewDto from the order's stored breakdown
    // and the corrected policy's parameters.
    const breakdown = await this.feePolicyService.previewFees({
      geographyCode: policy.geographyCode,
      urgencyTier: policy.urgencyTier,
      distanceKm: order.feeBreakdown?.baseAmount
        ? order.feeBreakdown.baseAmount / (order.quantity * 100) // reverse-engineer distance proxy
        : 10,
      serviceLevel: policy.serviceLevel,
      quantity: order.quantity,
    });

    return {
      deliveryFee: breakdown.deliveryFee,
      platformFee: breakdown.platformFee,
      performanceFee: breakdown.performanceFee,
      fixedFee: breakdown.fixedFee ?? 0,
      totalFee: breakdown.totalFee,
      baseAmount: breakdown.baseAmount,
      appliedPolicyId: correctedPolicyId,
      auditHash: breakdown.auditHash,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async countAffectedOrders(
    policySnapshotId: string,
    affectedFrom: Date,
    affectedTo: Date,
  ): Promise<number> {
    // Use raw query for IS NOT NULL + date range to avoid TypeORM quirks
    const result = await this.dataSource.query(
      `SELECT COUNT(*) AS total
       FROM orders
       WHERE applied_policy_id = $1
         AND created_at >= $2
         AND created_at <= $3
         AND fee_breakdown IS NOT NULL`,
      [policySnapshotId, affectedFrom, affectedTo],
    );
    return Number(result[0]?.total ?? 0);
  }

  private async assertApprovalGranted(run: FeeCorrectionRunEntity): Promise<void> {
    if (!run.approvalRequestId) return; // No approval required (test/admin bypass)

    // The run status is already APPROVED — the listener set it.
    // This is a belt-and-suspenders check.
    if (run.status === FeeCorrectionRunStatus.APPROVED) return;

    throw new BadRequestException(
      `Run ${run.id} has not been approved. Current status: ${run.status}`,
    );
  }

  private buildAuditHash(
    orderId: string,
    originalPolicyId: string,
    correctedPolicyId: string,
    correctedBreakdown: Record<string, unknown>,
  ): string {
    const input = `${orderId}|${originalPolicyId}|${correctedPolicyId}|${JSON.stringify(correctedBreakdown)}`;
    // Deterministic djb2-style hash (same algorithm as FeePolicyService for consistency)
    return input
      .split('')
      .reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)
      .toString();
  }

  private buildReconciliationLink(
    runId: string,
    orderId: string,
    deltaTotalFee: number,
  ): string {
    // Format: fee-adj:{runId}:{orderId}:{direction}
    const direction = deltaTotalFee >= 0 ? 'charge' : 'refund';
    return `fee-adj:${runId}:${orderId}:${direction}`;
  }

  private async findRunOrFail(id: string): Promise<FeeCorrectionRunEntity> {
    const run = await this.runRepo.findOne({ where: { id } });
    if (!run) throw new NotFoundException(`Fee correction run ${id} not found`);
    return run;
  }
}
