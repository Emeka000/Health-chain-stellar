import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { DisputeEntity } from '../disputes/entities/dispute.entity';
import { DisputeStatus } from '../disputes/enums/dispute.enum';
import { DonationEntity } from '../donations/entities/donation.entity';
import { DonationStatus } from '../donations/enums/donation.enum';
import { SorobanService } from '../soroban/soroban.service';

import { ReconciliationMismatchEntity } from './entities/reconciliation-mismatch.entity';
import { ReconciliationRunEntity } from './entities/reconciliation-run.entity';
import {
  ReconciliationSnapshotEntity,
  ReconciliationSnapshotStatus,
} from './entities/reconciliation-snapshot.entity';
import {
  ExceptionCategory,
  MismatchResolution,
  MismatchSeverity,
  MismatchType,
  ReconciliationRunStatus,
} from './enums/reconciliation.enum';

/** Matching tolerances */
const AMOUNT_TOLERANCE = 0.0000001;
const TIMESTAMP_TOLERANCE_MS = 60_000; // 1 minute
/** Rows fetched per keyset page; each run loops until a short page */
const RECONCILIATION_PAGE_SIZE = 200;

/**
 * On-chain payment status values returned by the payments contract's
 * `Payment` struct (`PaymentStatus` in `lifebank-soroban/contracts/payments`).
 */
type PaymentStatus =
  | 'Pending'
  | 'Locked'
  | 'Released'
  | 'Refunded'
  | 'Disputed'
  | 'Cancelled';

/**
 * Explicit mapping from the contract's `PaymentStatus` vocabulary to the
 * backend's `DonationStatus` vocabulary. Values with no mapping are absent
 * so callers can refuse to write them.
 */
const PAYMENT_STATUS_TO_DONATION_STATUS: Record<
  PaymentStatus,
  DonationStatus
> = {
  Pending: DonationStatus.PENDING,
  Locked: DonationStatus.PENDING,
  Released: DonationStatus.COMPLETED,
  Refunded: DonationStatus.CANCELLED,
  Disputed: DonationStatus.PENDING,
  Cancelled: DonationStatus.CANCELLED,
};

/**
 * Map a raw on-chain payment status to a `DonationStatus`.
 * Returns `null` when the value has no explicit mapping.
 */
function mapPaymentStatusToDonationStatus(
  status: string | null | undefined,
): DonationStatus | null {
  if (!status) return null;
  const mapped =
    PAYMENT_STATUS_TO_DONATION_STATUS[status as PaymentStatus];
  return mapped ?? null;
}

interface MismatchCandidate {
  referenceId: string;
  referenceType: string;
  type: MismatchType;
  severity: MismatchSeverity;
  onChainValue: Record<string, unknown> | null;
  offChainValue: Record<string, unknown> | null;
  exceptionCategory: ExceptionCategory;
  matchScore: number;
  remediationHint: string;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectRepository(ReconciliationRunEntity)
    private readonly runRepo: Repository<ReconciliationRunEntity>,
    @InjectRepository(ReconciliationMismatchEntity)
    private readonly mismatchRepo: Repository<ReconciliationMismatchEntity>,
    @InjectRepository(ReconciliationSnapshotEntity)
    private readonly snapshotRepo: Repository<ReconciliationSnapshotEntity>,
    @InjectRepository(DonationEntity)
    private readonly donationRepo: Repository<DonationEntity>,
    @InjectRepository(DisputeEntity)
    private readonly disputeRepo: Repository<DisputeEntity>,
    private readonly sorobanService: SorobanService,
  ) {}

  /**
   * Trigger a new reconciliation run.
   * If a snapshot for a previous interrupted run exists, resumes from that cursor.
   * Prevents concurrent runs via idempotency key and status checks.
   */
  async triggerRun(
    triggeredBy?: string,
    resumeRunId?: string,
    idempotencyKey?: string,
  ): Promise<ReconciliationRunEntity> {
    let run: ReconciliationRunEntity;
    let snapshot: ReconciliationSnapshotEntity | null = null;

    if (resumeRunId) {
      const existing = await this.runRepo.findOne({
        where: { id: resumeRunId },
      });
      if (!existing)
        throw new BadRequestException(`Run '${resumeRunId}' not found`);
      if (existing.status !== ReconciliationRunStatus.INTERRUPTED) {
        throw new BadRequestException(
          `Run '${resumeRunId}' is not in INTERRUPTED state`,
        );
      }
      run = existing;
      run.status = ReconciliationRunStatus.RUNNING;
      await this.runRepo.save(run);

      if (run.snapshotId) {
        snapshot = await this.snapshotRepo.findOne({
          where: { id: run.snapshotId },
        });
      }
    } else {
      // Check if any non-completed run is already in progress
      const inProgressRun = await this.runRepo.findOne({
        where: { status: ReconciliationRunStatus.RUNNING },
      });
      if (inProgressRun) {
        throw new BadRequestException(
          `A reconciliation run is already in progress (ID: ${inProgressRun.id})`,
        );
      }

      // Generate or use provided idempotency key
      const key =
        idempotencyKey ||
        `run-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Attempt to create a new run with the idempotency key
      run = this.runRepo.create({
        triggeredBy: triggeredBy ?? null,
        idempotencyKey: key,
      });

      try {
        await this.runRepo.save(run);
      } catch (error) {
        // Handle unique constraint violation (duplicate idempotency key)
        const err = error as Record<string, unknown>;
        if (
          err.code === 'ER_DUP_ENTRY' ||
          err.code === 'SQLITE_CONSTRAINT' ||
          err.code === '23505'
        ) {
          const existingRun = await this.runRepo.findOne({
            where: { idempotencyKey: key },
          });
          if (existingRun) {
            throw new BadRequestException(
              `A reconciliation run with idempotency key '${key}' already exists (ID: ${existingRun.id})`,
            );
          }
        }
        throw error;
      }

      snapshot = this.snapshotRepo.create({
        runId: run.id,
        cursors: {},
        processedCounts: {},
        exceptionSummary: {},
      });
      snapshot = await this.snapshotRepo.save(snapshot);
      run.snapshotId = snapshot.id;
      await this.runRepo.save(run);
    }

    // Run async, don't await
    this.executeRun(run, snapshot!).catch((err) =>
      this.logger.error(
        `Reconciliation run ${run.id} failed: ${(err as Error).message}`,
      ),
    );

    return run;
  }

  async getRuns(limit = 20): Promise<ReconciliationRunEntity[]> {
    return this.runRepo.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  async getMismatches(
    runId?: string,
    resolution?: MismatchResolution,
    exceptionCategory?: ExceptionCategory,
    limit = 50,
  ): Promise<ReconciliationMismatchEntity[]> {
    const where: Record<string, unknown> = {};
    if (runId) where['runId'] = runId;
    if (resolution) where['resolution'] = resolution;
    if (exceptionCategory) where['exceptionCategory'] = exceptionCategory;
    return this.mismatchRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async resync(
    mismatchId: string,
    userId: string,
  ): Promise<ReconciliationMismatchEntity> {
    const mismatch = await this.mismatchRepo.findOneOrFail({
      where: { id: mismatchId },
    });

    if (mismatch.resolution !== MismatchResolution.PENDING) {
      throw new BadRequestException('Mismatch is already resolved');
    }

    // Ambiguous matches must not be auto-merged — require manual resolution
    if (mismatch.exceptionCategory === ExceptionCategory.AMBIGUOUS_MATCH) {
      throw new BadRequestException(
        'Ambiguous matches cannot be auto-resynced. Use manual resolution.',
      );
    }

    if (mismatch.referenceType === 'donation' && mismatch.onChainValue) {
      const onChainStatus = mismatch.onChainValue['status'] as
        | string
        | undefined;
      if (onChainStatus) {
        // Refuse to write raw contract status values into donations.status.
        // Only explicitly mapped DonationStatus values may be persisted.
        const mappedStatus = mapPaymentStatusToDonationStatus(onChainStatus);
        if (!mappedStatus) {
          throw new BadRequestException(
            `Cannot resync donation status '${onChainStatus}': no mapping to DonationStatus`,
          );
        }
        await this.donationRepo.update(mismatch.referenceId, {
          status: mappedStatus,
        });
      }
    }

    if (mismatch.referenceType === 'dispute' && mismatch.onChainValue) {
      const onChainStatus = mismatch.onChainValue['status'] as
        | string
        | undefined;
      if (onChainStatus) {
        await this.disputeRepo.update(mismatch.referenceId, {
          status: onChainStatus as DisputeStatus,
        });
      }
    }

    mismatch.resolution = MismatchResolution.RESYNCED;
    mismatch.resolvedBy = userId;
    mismatch.resolvedAt = new Date();
    mismatch.resolutionNote = 'Auto-resynced from on-chain state';
    return this.mismatchRepo.save(mismatch);
  }

  async dismiss(
    mismatchId: string,
    userId: string,
    note: string,
  ): Promise<ReconciliationMismatchEntity> {
    const mismatch = await this.mismatchRepo.findOneOrFail({
      where: { id: mismatchId },
    });
    if (mismatch.resolution !== MismatchResolution.PENDING) {
      throw new BadRequestException('Mismatch is already resolved');
    }
    mismatch.resolution = MismatchResolution.DISMISSED;
    mismatch.resolvedBy = userId;
    mismatch.resolvedAt = new Date();
    mismatch.resolutionNote = note;
    return this.mismatchRepo.save(mismatch);
  }

  async markManual(
    mismatchId: string,
    userId: string,
    note: string,
  ): Promise<ReconciliationMismatchEntity> {
    const mismatch = await this.mismatchRepo.findOneOrFail({
      where: { id: mismatchId },
    });
    if (mismatch.resolution !== MismatchResolution.PENDING) {
      throw new BadRequestException('Mismatch is already resolved');
    }
    mismatch.resolution = MismatchResolution.MANUAL;
    mismatch.resolvedBy = userId;
    mismatch.resolvedAt = new Date();
    mismatch.resolutionNote = note;
    return this.mismatchRepo.save(mismatch);
  }

  // ── Private ──────────────────────────────────────────────────────────

  private async executeRun(
    run: ReconciliationRunEntity,
    snapshot: ReconciliationSnapshotEntity,
  ): Promise<void> {
    const mismatches: MismatchCandidate[] = [];

    try {
      snapshot.status = ReconciliationSnapshotStatus.IN_PROGRESS;
      await this.snapshotRepo.save(snapshot);

      const donationMismatches = await this.reconcileDonations(snapshot);
      const disputeMismatches = await this.reconcileDisputes(snapshot);
      mismatches.push(...donationMismatches, ...disputeMismatches);

      if (mismatches.length > 0) {
        // Dedup: only create a new mismatch row when no PENDING mismatch
        // already exists for the same (referenceId, type) combination.
        // This mirrors the pattern used in AnomalyScoringService.upsertAnomaly
        // and prevents duplicate HIGH-severity rows on every re-run.
        const toCreate: MismatchCandidate[] = [];
        for (const m of mismatches) {
          const existing = await this.mismatchRepo.findOne({
            where: {
              referenceId: m.referenceId,
              type: m.type,
              resolution: MismatchResolution.PENDING,
            },
          });
          if (!existing) {
            toCreate.push(m);
          }
        }
        if (toCreate.length > 0) {
          const entities = toCreate.map((m) =>
            this.mismatchRepo.create({ ...m, runId: run.id }),
          );
          await this.mismatchRepo.save(entities);
        }
      }

      // Build exception summary
      const exceptionSummary: Record<string, number> = {};
      for (const m of mismatches) {
        exceptionSummary[m.exceptionCategory] =
          (exceptionSummary[m.exceptionCategory] ?? 0) + 1;
      }
      snapshot.exceptionSummary = exceptionSummary;
      snapshot.status = ReconciliationSnapshotStatus.COMPLETED;
      await this.snapshotRepo.save(snapshot);

      run.status = ReconciliationRunStatus.COMPLETED;
      run.totalChecked =
        (snapshot.processedCounts['donation'] ?? 0) +
        (snapshot.processedCounts['dispute'] ?? 0);
      run.mismatchCount = mismatches.length;
      run.completedAt = new Date();
    } catch (err) {
      // Mark as interrupted so it can be resumed
      snapshot.status = ReconciliationSnapshotStatus.INTERRUPTED;
      await this.snapshotRepo.save(snapshot);

      run.status = ReconciliationRunStatus.INTERRUPTED;
      run.errorMessage = (err as Error).message;
      run.completedAt = new Date();
    }

    await this.runRepo.save(run);
  }

  private async reconcileDonations(
    snapshot: ReconciliationSnapshotEntity,
  ): Promise<MismatchCandidate[]> {
    const mismatches: MismatchCandidate[] = [];

    for (;;) {
      const cursor = snapshot.cursors['donation'];

      const qb = this.donationRepo
        .createQueryBuilder('d')
        .where('d.status IN (:...statuses)', {
          statuses: [DonationStatus.PENDING, DonationStatus.COMPLETED],
        })
        .orderBy('d.id', 'ASC')
        .take(RECONCILIATION_PAGE_SIZE);

      if (cursor) qb.andWhere('d.id > :cursor', { cursor });

      const donations = await qb.getMany();
      if (donations.length === 0) break;

      await this.reconcileDonationPage(donations, snapshot, mismatches);

      // Cursor advances per page so skipped rows (no transactionHash) never stall the loop
      snapshot.cursors = {
        ...snapshot.cursors,
        donation: donations[donations.length - 1].id,
      };
      await this.snapshotRepo.save(snapshot);

      if (donations.length < RECONCILIATION_PAGE_SIZE) break;
    }

    return mismatches;
  }

  private async reconcileDonationPage(
    donations: DonationEntity[],
    snapshot: ReconciliationSnapshotEntity,
    mismatches: MismatchCandidate[],
  ): Promise<void> {
    for (const donation of donations) {
      if (!donation.transactionHash) continue;

      try {
        // The payments contract's get_payment view takes a u64 payment_id,
        // not a transaction hash. Resolve the on-chain payment id first.
        const paymentId = await this.resolvePaymentId(donation);
        if (paymentId === null) {
          mismatches.push(
            this.buildMismatch(
              donation.id,
              'donation',
              MismatchType.MISSING_ON_CHAIN,
              MismatchSeverity.HIGH,
              null,
              { status: donation.status, amount: donation.amount },
              ExceptionCategory.MISSING_ON_CHAIN,
              0,
              'Verify transaction was submitted; re-submit if necessary',
            ),
          );
          continue;
        }

        const onChain = await this.sorobanService.executeWithRetry(() =>
          this.fetchPaymentState(paymentId),
        );

        if (!onChain) {
          mismatches.push(
            this.buildMismatch(
              donation.id,
              'donation',
              MismatchType.MISSING_ON_CHAIN,
              MismatchSeverity.HIGH,
              null,
              { status: donation.status, amount: donation.amount },
              ExceptionCategory.MISSING_ON_CHAIN,
              0,
              'Verify transaction was submitted; re-submit if necessary',
            ),
          );
          continue;
        }

        // Status check — compare mapped DonationStatus vocabularies.
        const mappedStatus = mapPaymentStatusToDonationStatus(onChain.status);
        if (mappedStatus === null) {
          this.logger.warn(
            `Donation ${donation.id}: on-chain payment status '${onChain.status}' has no DonationStatus mapping`,
          );
        } else if (mappedStatus !== donation.status) {
          const score = this.rankCandidate(
            { status: mappedStatus },
            { status: donation.status },
          );
          mismatches.push(
            this.buildMismatch(
              donation.id,
              'donation',
              MismatchType.STATUS,
              MismatchSeverity.HIGH,
              { status: onChain.status },
              { status: donation.status },
              ExceptionCategory.STATUS_DIVERGENCE,
              score,
              'Review on-chain status and resync if authoritative',
            ),
          );
        }

        // Amount check with tolerance
        if (onChain.amount !== undefined) {
          const diff = Math.abs(
            Number(onChain.amount) - Number(donation.amount),
          );
          if (diff > AMOUNT_TOLERANCE) {
            mismatches.push(
              this.buildMismatch(
                donation.id,
                'donation',
                MismatchType.AMOUNT,
                MismatchSeverity.HIGH,
                { amount: onChain.amount },
                { amount: donation.amount },
                ExceptionCategory.AMOUNT_DISCREPANCY,
                diff,
                'Investigate amount discrepancy; do not auto-merge',
              ),
            );
          }
        }

        // Timestamp skew check
        if (onChain.timestamp !== undefined) {
          const skewMs = Math.abs(
            new Date(onChain.timestamp).getTime() -
              new Date(donation.createdAt).getTime(),
          );
          if (skewMs > TIMESTAMP_TOLERANCE_MS) {
            mismatches.push(
              this.buildMismatch(
                donation.id,
                'donation',
                MismatchType.TIMESTAMP,
                MismatchSeverity.LOW,
                { timestamp: onChain.timestamp },
                { createdAt: donation.createdAt },
                ExceptionCategory.TIMESTAMP_SKEW,
                skewMs,
                'Timestamp skew within acceptable range; dismiss if no other issues',
              ),
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `Could not reconcile donation ${donation.id}: ${(err as Error).message}`,
        );
      }

      snapshot.processedCounts = {
        ...snapshot.processedCounts,
        donation: (snapshot.processedCounts['donation'] ?? 0) + 1,
      };
    }
  }

  private async reconcileDisputes(
    snapshot: ReconciliationSnapshotEntity,
  ): Promise<MismatchCandidate[]> {
    const mismatches: MismatchCandidate[] = [];

    for (;;) {
      const cursor = snapshot.cursors['dispute'];

      const qb = this.disputeRepo
        .createQueryBuilder('d')
        .where('d.status = :status', { status: DisputeStatus.OPEN })
        .orderBy('d.id', 'ASC')
        .take(RECONCILIATION_PAGE_SIZE);

      if (cursor) qb.andWhere('d.id > :cursor', { cursor });

      const disputes = await qb.getMany();
      if (disputes.length === 0) break;

      await this.reconcileDisputePage(disputes, snapshot, mismatches);

      snapshot.cursors = {
        ...snapshot.cursors,
        dispute: disputes[disputes.length - 1].id,
      };
      await this.snapshotRepo.save(snapshot);

      if (disputes.length < RECONCILIATION_PAGE_SIZE) break;
    }

    return mismatches;
  }

  private async reconcileDisputePage(
    disputes: DisputeEntity[],
    snapshot: ReconciliationSnapshotEntity,
    mismatches: MismatchCandidate[],
  ): Promise<void> {
    for (const dispute of disputes) {
      if (!dispute.contractDisputeId) continue;

      try {
        const onChain = await this.sorobanService.executeWithRetry(() =>
          this.fetchDisputeState(dispute.contractDisputeId!),
        );

        if (!onChain) {
          mismatches.push(
            this.buildMismatch(
              dispute.id,
              'dispute',
              MismatchType.MISSING_ON_CHAIN,
              MismatchSeverity.MEDIUM,
              null,
              { status: dispute.status },
              ExceptionCategory.MISSING_ON_CHAIN,
              0,
              'Dispute not found on-chain; verify contract dispute ID',
            ),
          );
          continue;
        }

        if (onChain.status && onChain.status !== (dispute.status as string)) {
          const score = this.rankCandidate(
            { status: onChain.status },
            { status: dispute.status },
          );
          mismatches.push(
            this.buildMismatch(
              dispute.id,
              'dispute',
              MismatchType.STATUS,
              MismatchSeverity.MEDIUM,
              { status: onChain.status },
              { status: dispute.status },
              ExceptionCategory.STATUS_DIVERGENCE,
              score,
              'Review dispute status divergence; resync if on-chain is authoritative',
            ),
          );
        }
      } catch (err) {
        this.logger.warn(
          `Could not reconcile dispute ${dispute.id}: ${(err as Error).message}`,
        );
      }

      snapshot.processedCounts = {
        ...snapshot.processedCounts,
        dispute: (snapshot.processedCounts['dispute'] ?? 0) + 1,
      };
    }
  }

  /**
   * Deterministic ranking score for ambiguous candidates.
   * Lower score = better match. Based on field-level similarity.
   */
  private rankCandidate(
    onChain: Record<string, unknown>,
    offChain: Record<string, unknown>,
  ): number {
    let score = 0;
    for (const key of Object.keys(onChain)) {
      if (onChain[key] !== offChain[key]) score += 1;
    }
    return score;
  }

  private buildMismatch(
    referenceId: string,
    referenceType: string,
    type: MismatchType,
    severity: MismatchSeverity,
    onChainValue: Record<string, unknown> | null,
    offChainValue: Record<string, unknown> | null,
    exceptionCategory: ExceptionCategory,
    matchScore: number,
    remediationHint: string,
  ): MismatchCandidate {
    return {
      referenceId,
      referenceType,
      type,
      severity,
      onChainValue,
      offChainValue,
      exceptionCategory,
      matchScore,
      remediationHint,
    };
  }

  /**
   * Resolve the on-chain `payment_id` (u64) for a donation.
   *
   * Prefers the `paymentId` stored on the donation entity when the payment
   * was created. Falls back to looking the payment up by its request id via
   * the payments contract's `get_payment_by_request` view.
   *
   * Returns `null` when no payment id can be determined.
   */
  private async resolvePaymentId(
    donation: DonationEntity,
  ): Promise<bigint | null> {
    const stored = (donation as unknown as { paymentId?: unknown }).paymentId;
    if (stored !== undefined && stored !== null && stored !== '') {
      try {
        return BigInt(stored as string | number | bigint);
      } catch {
        this.logger.warn(
          `Donation ${donation.id}: stored paymentId '${String(stored)}' is not a valid u64`,
        );
      }
    }

    const requestId = (donation as unknown as { requestId?: unknown })
      .requestId;
    if (requestId !== undefined && requestId !== null && requestId !== '') {
      try {
        const paymentId =
          await this.sorobanService.getPaymentIdByRequest(
            String(requestId),
          );
        if (paymentId !== null && paymentId !== undefined) {
          return BigInt(paymentId as string | number | bigint);
        }
      } catch (err) {
        this.logger.warn(
          `Donation ${donation.id}: get_payment_by_request failed — ${(err as Error).message}`,
        );
      }
    }

    return null;
  }

  /**
   * Fetch on-chain payment state for a donation by its u64 payment id.
   *
   * Delegates to SorobanService.getPaymentState, which calls the payments
   * contract's `get_payment(payment_id: u64)` view and decodes the returned
   * `Payment` struct. Returns null when the payment is not found.
   */
  private async fetchPaymentState(
    paymentId: bigint,
  ): Promise<{ status: string; amount?: number; timestamp?: string } | null> {
    try {
      const result = await this.sorobanService.getPaymentState(paymentId);
      if (!result) return null;
      return {
        status: result.status,
        amount: result.amount !== undefined ? Number(result.amount) : undefined,
        timestamp: result.timestamp,
      };
    } catch (err) {
      this.logger.warn(
        `fetchPaymentState(${paymentId.toString()}): Soroban RPC call failed — ${(err as Error).message}`,
      );
      // Re-throw so the caller's try/catch can skip this record instead of
      // recording a false-positive MISSING_ON_CHAIN mismatch.
      throw err;
    }
  }

  /**
   * Fetch on-chain dispute state for a contract dispute ID.
   *
   * Delegates to SorobanService.getDisputeState which wraps the payments
   * contract's get_dispute view function.
   */
  private async fetchDisputeState(
    contractDisputeId: string,
  ): Promise<{ status: string } | null> {
    if (!contractDisputeId) return null;

    try {
      const result =
        await this.sorobanService.getDisputeState(contractDisputeId);
      return result ? { status: result.status } : null;
    } catch (err) {
      this.logger.warn(
        `fetchDisputeState(${contractDisputeId}): Soroban RPC call failed — ${(err as Error).message}`,
      );
      throw err;
    }
  }
}