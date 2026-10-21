import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';

import { ConsentService } from '../../consent/consent.service';
import { PledgeEntity } from '../entities/pledge.entity';
import { DonationAsset } from '../enums/donation.enum';
import { PledgeFrequency, PledgeStatus } from '../enums/pledge.enum';

function addInterval(from: Date, frequency: PledgeFrequency): Date {
  const d = new Date(from.getTime());
  switch (frequency) {
    case PledgeFrequency.WEEKLY:
      d.setUTCDate(d.getUTCDate() + 7);
      break;
    case PledgeFrequency.MONTHLY:
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case PledgeFrequency.QUARTERLY:
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    default:
      d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d;
}

@Injectable()
export class PledgeService {
  constructor(
    @InjectRepository(PledgeEntity)
    private readonly pledgeRepo: Repository<PledgeEntity>,
    private readonly consentService: ConsentService,
  ) {}

  async createPledge(params: {
    amount: number;
    payerAddress: string;
    recipientId: string;
    frequency: PledgeFrequency;
    causeTag?: string;
    regionTag?: string;
    emergencyPool?: boolean;
    asset?: DonationAsset;
    donorUserId?: string;
    sorobanPledgeId?: string;
  }): Promise<PledgeEntity> {
    // Enforce consent currency — no participant may enroll under superseded terms
    if (params.donorUserId) {
      await this.consentService.assertCurrentConsent(params.donorUserId);
    }

    const memo = `PLG-${uuidv4().substring(0, 8).toUpperCase()}`;
    const now = new Date();
    const nextExecutionAt = addInterval(now, params.frequency);

    const pledge = this.pledgeRepo.create({
      amount: params.amount,
      payerAddress: params.payerAddress,
      recipientId: params.recipientId,
      frequency: params.frequency,
      causeTag: params.causeTag ?? '',
      regionTag: params.regionTag ?? '',
      emergencyPool: params.emergencyPool ?? false,
      asset: params.asset ?? DonationAsset.XLM,
      memo,
      status: PledgeStatus.ACTIVE,
      donorUserId: params.donorUserId ?? null,
      sorobanPledgeId: params.sorobanPledgeId ?? null,
      nextExecutionAt,
    });

    return this.pledgeRepo.save(pledge);
  }

  async listByPayer(payerAddress: string): Promise<PledgeEntity[]> {
    return this.pledgeRepo.find({
      where: { payerAddress },
      order: { createdAt: 'DESC' },
    });
  }

  async listByDonorUserId(donorUserId: string): Promise<PledgeEntity[]> {
    return this.pledgeRepo.find({
      where: { donorUserId },
      order: { createdAt: 'DESC' },
    });
  }

  async getById(id: string, callerUserId?: string): Promise<PledgeEntity> {
    const p = await this.pledgeRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Pledge not found');

    // Enforce ownership: only the donor can view
    if (callerUserId && p.donorUserId && p.donorUserId !== callerUserId) {
      throw new NotFoundException('Pledge not found');
    }

    return p;
  }

  async setStatus(id: string, status: PledgeStatus, callerUserId?: string): Promise<PledgeEntity> {
    const p = await this.getById(id, callerUserId);

    // Ensure caller is the pledge owner
    if (callerUserId && p.donorUserId && p.donorUserId !== callerUserId) {
      throw new ForbiddenException('You are not authorized to modify this pledge');
    }

    // Validate state transitions
    this.validateTransition(p.status, status);

    p.status = status;
    return this.pledgeRepo.save(p);
  }

  /**
   * Validate pledge status transitions.
   * Allowed transitions:
   * - ACTIVE <-> PAUSED (pause/resume)
   * - ACTIVE|PAUSED -> COMPLETED (complete)
   * - COMPLETED is terminal (no transitions out)
   */
  private validateTransition(currentStatus: PledgeStatus, targetStatus: PledgeStatus): void {
    if (currentStatus === PledgeStatus.COMPLETED) {
      throw new BadRequestException('Cannot modify a completed pledge');
    }

    if (currentStatus === PledgeStatus.ACTIVE && targetStatus === PledgeStatus.PAUSED) {
      return; // Valid: pause active pledge
    }

    if (currentStatus === PledgeStatus.PAUSED && targetStatus === PledgeStatus.ACTIVE) {
      return; // Valid: resume paused pledge
    }

    if ((currentStatus === PledgeStatus.ACTIVE || currentStatus === PledgeStatus.PAUSED) && targetStatus === PledgeStatus.COMPLETED) {
      return; // Valid: complete active or paused pledge
    }

    // Invalid transition
    throw new BadRequestException(
      `Invalid status transition from ${currentStatus} to ${targetStatus}. ` +
      'Allowed: ACTIVE <-> PAUSED, ACTIVE|PAUSED -> COMPLETED'
    );
  }
}
