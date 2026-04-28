import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { DonationEntity } from '../../donations/entities/donation.entity';
import { DonationStatus } from '../../donations/enums/donation.enum';
import { DisputeEntity } from '../../disputes/entities/dispute.entity';
import { DisputeStatus } from '../../disputes/enums/dispute.enum';
import { SorobanService } from '../../soroban/soroban.service';

import { ReconciliationRunEntity } from '../entities/reconciliation-run.entity';
import { ReconciliationMismatchEntity } from '../entities/reconciliation-mismatch.entity';
import {
  ReconciliationSnapshotEntity,
  ReconciliationSnapshotStatus,
} from '../entities/reconciliation-snapshot.entity';
import {
  ExceptionCategory,
  MismatchResolution,
  MismatchSeverity,
  MismatchType,
  ReconciliationRunStatus,
} from '../enums/reconciliation.enum';

/** Matching tolerances */
const AMOUNT_TOLERANCE = 0.0000001;
const TIMESTAMP_TOLERANCE_MS = 60_000; // 1 minute

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
   */
  async triggerRun(triggeredBy?: string, resumeRunId?: string): Promise<ReconciliationRunEntity> {
    let run: ReconciliationRunEntity;
    let snapshot: ReconciliationSnapshotEntity | null = null;

    if (resumeRunId) {
      const existing = await this.runRepo.findOne({ where: { id: resumeRunId } });
      if (!existing) throw new BadRequestException(`Run '${resumeRunId}' not found`);
      if (existing.status !== ReconciliationRunStatus.INTERRUPTED) {
        throw new BadRequestException(`Run '${resumeRunId}' is not in INTERRUPTED state`);
      }
      run = existing;
      run.status = ReconciliationRunStatus.RUNNING;
      await this.runRepo.save(run);

      if (run.snapshotId) {
        snapshot = await this.snapshotRepo.findOne({ where: { id: run.snapshotId } });
      }
    } else {
      run = this.runRepo.create({ triggeredBy: triggeredBy ?? null });
      await this.runRepo.save(run);

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
      this.logger.error(`Reconciliation run ${run.id} failed: ${(err as Error).message}`),
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
    return this.mismatchRepo.find({ where, order: { createdAt: 'DESC' }, take: limit });
  }

  async resync(mismatchId: string, userId: string): Promise<ReconciliationMismatchEntity> {
    const mismatch = await this.mismatchRepo.findOneOrFail({ where: { id: mismatchId } });

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
      const onChainStatus = mismatch.onChainValue['status'] as string | undefined;
      if (onChainStatus) {
        await this.donationRepo.update(mismatch.referenceId, {
          status: onChainStatus as DonationStatus,
        });
      }
    }

    if (mismatch.referenceType === 'dispute' && mismatch.onChainValue) {
      const onChainStatus = mismatch.onChainValue['status'] as string | undefined;
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

  async dismiss(mismatchId: string, userId: string, note: string): Promise<ReconciliationMismatchEntity> {
    const mismatch = await this.mismatchRepo.findOneOrFail({ where: { id: mismatchId } });
    mismatch.resolution = MismatchResolution.DISMISSED;
    mismatch.resolvedBy = userId;
    mismatch.resolvedAt = new Date();
    mismatch.resolutionNote = note;
    return this.mismatchRepo.save(mismatch);
  }

  async markManual(mismatchId: string, userId: string, note: string): Promise<ReconciliationMismatchEntity> {
    const mismatch = await this.mismatchRepo.findOneOrFail({ where: { id: mismatchId } });
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
        const entities = mismatches.map((m) =>
          this.mismatchRepo.create({ ...m, runId: run.id }),
        );
        await this.mismatchRepo.save(entities);
      }

      // Build exception summary
      const exceptionSummary: Record<string, number> = {};
      for (const m of mismatches) {
        exceptionSummary[m.exceptionCategory] = (exceptionSummary[m.exceptionCategory] ?? 0) + 1;
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

  private async reconcileDonations(snapshot: ReconciliationSnapshotEntity): Promise<MismatchCandidate[]> {
    const mismatches: MismatchCandidate[] = [];
    const cursor = snapshot.cursors['donation'];

    const qb = this.donationRepo.createQueryBuilder('d')
      .where('d.status IN (:...statuses)', { statuses: [DonationStatus.PENDING, DonationStatus.COMPLETED] })
      .orderBy('d.id', 'ASC')
      .take(200);

    if (cursor) qb.andWhere('d.id > :cursor', { cursor });

    const donations = await qb.getMany();

    for (const donation of donations) {
      if (!donation.transactionHash) continue;

      try {
        const onChain = await this.sorobanService.executeWithRetry(() =>
          this.fetchPaymentState(donation.transactionHash),
        );

        if (!onChain) {
          mismatches.push(this.buildMismatch(
            donation.id, 'donation',
            MismatchType.MISSING_ON_CHAIN, MismatchSeverity.HIGH,
            null, { status: donation.status, amount: donation.amount },
            ExceptionCategory.MISSING_ON_CHAIN, 0,
            'Verify transaction was submitted; re-submit if necessary',
          ));
          continue;
        }

        // Status check
        if (onChain.status !== donation.status) {
          const score = this.rankCandidate({ status: onChain.status }, { status: donation.status });
          mismatches.push(this.buildMismatch(
            donation.id, 'donation',
            MismatchType.STATUS, MismatchSeverity.HIGH,
            { status: onChain.status }, { status: donation.status },
            ExceptionCategory.STATUS_DIVERGENCE, score,
            'Review on-chain status and resync if authoritative',
          ));
        }

        // Amount check with tolerance
        if (onChain.amount !== undefined) {
          const diff = Math.abs(Number(onChain.amount) - Number(donation.amount));
          if (diff > AMOUNT_TOLERANCE) {
            mismatches.push(this.buildMismatch(
              donation.id, 'donation',
              MismatchType.AMOUNT, MismatchSeverity.HIGH,
              { amount: onChain.amount }, { amount: donation.amount },
              ExceptionCategory.AMOUNT_DISCREPANCY, diff,
              'Investigate amount discrepancy; do not auto-merge',
            ));
          }
        }

        // Timestamp skew check
        if (onChain.timestamp !== undefined) {
          const skewMs = Math.abs(
            new Date(onChain.timestamp as string).getTime() -
            new Date(donation.createdAt).getTime(),
          );
          if (skewMs > TIMESTAMP_TOLERANCE_MS) {
            mismatches.push(this.buildMismatch(
              donation.id, 'donation',
              MismatchType.TIMESTAMP, MismatchSeverity.LOW,
              { timestamp: onChain.timestamp }, { createdAt: donation.createdAt },
              ExceptionCategory.TIMESTAMP_SKEW, skewMs,
              'Timestamp skew within acceptable range; dismiss if no other issues',
            ));
          }
        }
      } catch (err) {
        this.logger.warn(`Could not reconcile donation ${donation.id}: ${(err as Error).message}`);
      }

      // Update cursor for resume
      snapshot.cursors = { ...snapshot.cursors, donation: donation.id };
      snapshot.processedCounts = {
        ...snapshot.processedCounts,
        donation: (snapshot.processedCounts['donation'] ?? 0) + 1,
      };
    }

    if (donations.length > 0) await this.snapshotRepo.save(snapshot);
    return mismatches;
  }

  private async reconcileDisputes(snapshot: ReconciliationSnapshotEntity): Promise<MismatchCandidate[]> {
    const mismatches: MismatchCandidate[] = [];
    const cursor = snapshot.cursors['dispute'];

    const qb = this.disputeRepo.createQueryBuilder('d')
      .where('d.status = :status', { status: DisputeStatus.OPEN })
      .orderBy('d.id', 'ASC')
      .take(100);

    if (cursor) qb.andWhere('d.id > :cursor', { cursor });

    const disputes = await qb.getMany();

    for (const dispute of disputes) {
      if (!dispute.contractDisputeId) continue;

      try {
        const onChain = await this.sorobanService.executeWithRetry(() =>
          this.fetchDisputeState(dispute.contractDisputeId!),
        );

        if (!onChain) {
          mismatches.push(this.buildMismatch(
            dispute.id, 'dispute',
            MismatchType.MISSING_ON_CHAIN, MismatchSeverity.MEDIUM,
            null, { status: dispute.status },
            ExceptionCategory.MISSING_ON_CHAIN, 0,
            'Dispute not found on-chain; verify contract dispute ID',
          ));
          continue;
        }

        if (onChain.status && onChain.status !== dispute.status) {
          const score = this.rankCandidate({ status: onChain.status }, { status: dispute.status });
          mismatches.push(this.buildMismatch(
            dispute.id, 'dispute',
            MismatchType.STATUS, MismatchSeverity.MEDIUM,
            { status: onChain.status }, { status: dispute.status },
            ExceptionCategory.STATUS_DIVERGENCE, score,
            'Review dispute status divergence; resync if on-chain is authoritative',
          ));
        }
      } catch (err) {
        this.logger.warn(`Could not reconcile dispute ${dispute.id}: ${(err as Error).message}`);
      }

      snapshot.cursors = { ...snapshot.cursors, dispute: dispute.id };
      snapshot.processedCounts = {
        ...snapshot.processedCounts,
        dispute: (snapshot.processedCounts['dispute'] ?? 0) + 1,
      };
    }

    if (disputes.length > 0) await this.snapshotRepo.save(snapshot);
    return mismatches;
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
      referenceId, referenceType, type, severity,
      onChainValue, offChainValue,
      exceptionCategory, matchScore, remediationHint,
    };
  }

  /** Stub: replace with real Soroban contract call for payment state */
  private async fetchPaymentState(
    txHash: string,
  ): Promise<{ status: string; amount?: number; timestamp?: string } | null> {
    void txHash;
    return null;
  }

  /** Stub: replace with real Soroban contract call for dispute state */
  private async fetchDisputeState(contractDisputeId: string): Promise<{ status: string } | null> {
    void contractDisputeId;
    return null;
  }
}

