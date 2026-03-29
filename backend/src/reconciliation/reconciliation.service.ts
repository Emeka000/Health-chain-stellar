import { Injectable, Logger } from '@nestjs/common';
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
  MismatchType,
  MismatchSeverity,
  MismatchResolution,
  ReconciliationRunStatus,
} from '../enums/reconciliation.enum';

interface MismatchCandidate {
  referenceId: string;
  referenceType: string;
  type: MismatchType;
  severity: MismatchSeverity;
  onChainValue: Record<string, unknown> | null;
  offChainValue: Record<string, unknown> | null;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectRepository(ReconciliationRunEntity)
    private readonly runRepo: Repository<ReconciliationRunEntity>,
    @InjectRepository(ReconciliationMismatchEntity)
    private readonly mismatchRepo: Repository<ReconciliationMismatchEntity>,
    @InjectRepository(DonationEntity)
    private readonly donationRepo: Repository<DonationEntity>,
    @InjectRepository(DisputeEntity)
    private readonly disputeRepo: Repository<DisputeEntity>,
    private readonly sorobanService: SorobanService,
  ) {}

  async triggerRun(triggeredBy?: string): Promise<ReconciliationRunEntity> {
    const run = this.runRepo.create({ triggeredBy: triggeredBy ?? null });
    await this.runRepo.save(run);

    // Run async, don't await
    this.executeRun(run).catch((err) =>
      this.logger.error(`Reconciliation run ${run.id} failed: ${err.message}`),
    );

    return run;
  }

  async getRuns(limit = 20): Promise<ReconciliationRunEntity[]> {
    return this.runRepo.find({ order: { createdAt: 'DESC' }, take: limit });
  }

  async getMismatches(
    runId?: string,
    resolution?: MismatchResolution,
    limit = 50,
  ): Promise<ReconciliationMismatchEntity[]> {
    const where: Record<string, unknown> = {};
    if (runId) where['runId'] = runId;
    if (resolution) where['resolution'] = resolution;
    return this.mismatchRepo.find({ where, order: { createdAt: 'DESC' }, take: limit });
  }

  async resync(mismatchId: string, userId: string): Promise<ReconciliationMismatchEntity> {
    const mismatch = await this.mismatchRepo.findOneOrFail({ where: { id: mismatchId } });

    if (mismatch.resolution !== MismatchResolution.PENDING) {
      throw new Error('Mismatch is already resolved');
    }

    // Attempt recoverable resync: update off-chain record to match on-chain value
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

  // ── Private ──────────────────────────────────────────────────────────

  private async executeRun(run: ReconciliationRunEntity): Promise<void> {
    const mismatches: MismatchCandidate[] = [];

    try {
      const donationMismatches = await this.reconcileDonations();
      const disputeMismatches = await this.reconcileDisputes();
      mismatches.push(...donationMismatches, ...disputeMismatches);

      if (mismatches.length > 0) {
        const entities = mismatches.map((m) =>
          this.mismatchRepo.create({ ...m, runId: run.id }),
        );
        await this.mismatchRepo.save(entities);
      }

      run.status = ReconciliationRunStatus.COMPLETED;
      run.totalChecked = mismatches.length + (await this.donationRepo.count()) + (await this.disputeRepo.count());
      run.mismatchCount = mismatches.length;
      run.completedAt = new Date();
    } catch (err) {
      run.status = ReconciliationRunStatus.FAILED;
      run.errorMessage = (err as Error).message;
      run.completedAt = new Date();
    }

    await this.runRepo.save(run);
  }

  private async reconcileDonations(): Promise<MismatchCandidate[]> {
    const mismatches: MismatchCandidate[] = [];
    const donations = await this.donationRepo.find({
      where: [{ status: DonationStatus.PENDING }, { status: DonationStatus.COMPLETED }],
      take: 200,
      order: { createdAt: 'DESC' },
    });

    for (const donation of donations) {
      if (!donation.transactionHash) continue;

      try {
        // Query on-chain payment state via Soroban
        const onChain = await this.sorobanService.executeWithRetry(() =>
          this.fetchPaymentState(donation.transactionHash),
        );

        if (!onChain) {
          mismatches.push({
            referenceId: donation.id,
            referenceType: 'donation',
            type: MismatchType.MISSING_ON_CHAIN,
            severity: MismatchSeverity.HIGH,
            onChainValue: null,
            offChainValue: { status: donation.status, amount: donation.amount },
          });
          continue;
        }

        if (onChain.status !== donation.status) {
          mismatches.push({
            referenceId: donation.id,
            referenceType: 'donation',
            type: MismatchType.STATUS,
            severity: MismatchSeverity.HIGH,
            onChainValue: { status: onChain.status },
            offChainValue: { status: donation.status },
          });
        }

        if (onChain.amount !== undefined && Math.abs(Number(onChain.amount) - Number(donation.amount)) > 0.0000001) {
          mismatches.push({
            referenceId: donation.id,
            referenceType: 'donation',
            type: MismatchType.AMOUNT,
            severity: MismatchSeverity.HIGH,
            onChainValue: { amount: onChain.amount },
            offChainValue: { amount: donation.amount },
          });
        }
      } catch (err) {
        this.logger.warn(`Could not reconcile donation ${donation.id}: ${(err as Error).message}`);
      }
    }

    return mismatches;
  }

  private async reconcileDisputes(): Promise<MismatchCandidate[]> {
    const mismatches: MismatchCandidate[] = [];
    const disputes = await this.disputeRepo.find({
      where: { status: DisputeStatus.OPEN },
      take: 100,
      order: { createdAt: 'DESC' },
    });

    for (const dispute of disputes) {
      if (!dispute.contractDisputeId) continue;

      try {
        const onChain = await this.sorobanService.executeWithRetry(() =>
          this.fetchDisputeState(dispute.contractDisputeId!),
        );

        if (!onChain) {
          mismatches.push({
            referenceId: dispute.id,
            referenceType: 'dispute',
            type: MismatchType.MISSING_ON_CHAIN,
            severity: MismatchSeverity.MEDIUM,
            onChainValue: null,
            offChainValue: { status: dispute.status },
          });
          continue;
        }

        if (onChain.status && onChain.status !== dispute.status) {
          mismatches.push({
            referenceId: dispute.id,
            referenceType: 'dispute',
            type: MismatchType.STATUS,
            severity: MismatchSeverity.MEDIUM,
            onChainValue: { status: onChain.status },
            offChainValue: { status: dispute.status },
          });
        }
      } catch (err) {
        this.logger.warn(`Could not reconcile dispute ${dispute.id}: ${(err as Error).message}`);
      }
    }

    return mismatches;
  }

  /** Stub: replace with real Soroban contract call for payment state */
  private async fetchPaymentState(txHash: string): Promise<{ status: string; amount?: number } | null> {
    // In production this calls the payments contract `get_payment` function.
    // Returning null here means "not found on-chain".
    void txHash;
    return null;
  }

  /** Stub: replace with real Soroban contract call for dispute state */
  private async fetchDisputeState(contractDisputeId: string): Promise<{ status: string } | null> {
    void contractDisputeId;
    return null;
  }
}
