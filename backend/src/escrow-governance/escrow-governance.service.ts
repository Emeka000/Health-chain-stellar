import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';

import { DataSource, LessThan, Repository } from 'typeorm';

import { AuditLogService } from '../common/audit/audit-log.service';

import {
  AddSignerDto,
  CancelProposalDto,
  CastVoteDto,
  CreateEscrowProposalDto,
  CreateThresholdPolicyDto,
  RevokeSignerDto,
  SuspendSignerDto,
} from './dto/escrow-governance.dto';
import { EscrowProposalEntity } from './entities/escrow-proposal.entity';
import { EscrowSignerEntity } from './entities/escrow-signer.entity';
import { EscrowThresholdPolicyEntity } from './entities/escrow-threshold-policy.entity';
import { EscrowVoteEntity } from './entities/escrow-vote.entity';
import {
  EscrowProposalStatus,
  EscrowRiskProfile,
  EscrowSignerStatus,
  EscrowVoteDecision,
} from './enums/escrow-governance.enum';

/** Emitted when a proposal reaches its approval threshold. */
export class EscrowProposalApprovedEvent {
  constructor(public readonly proposal: EscrowProposalEntity) {}
}

/** Emitted when a proposal is rejected (any signer votes REJECT). */
export class EscrowProposalRejectedEvent {
  constructor(public readonly proposal: EscrowProposalEntity) {}
}

/** Emitted when a proposal is executed on-chain. */
export class EscrowProposalExecutedEvent {
  constructor(
    public readonly proposal: EscrowProposalEntity,
    public readonly txHash: string,
  ) {}
}

@Injectable()
export class EscrowGovernanceService {
  private readonly logger = new Logger(EscrowGovernanceService.name);

  constructor(
    @InjectRepository(EscrowProposalEntity)
    private readonly proposalRepo: Repository<EscrowProposalEntity>,
    @InjectRepository(EscrowVoteEntity)
    private readonly voteRepo: Repository<EscrowVoteEntity>,
    @InjectRepository(EscrowSignerEntity)
    private readonly signerRepo: Repository<EscrowSignerEntity>,
    @InjectRepository(EscrowThresholdPolicyEntity)
    private readonly policyRepo: Repository<EscrowThresholdPolicyEntity>,
    private readonly auditLog: AuditLogService,
    private readonly eventEmitter: EventEmitter2,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // ── Threshold Policy Management ──────────────────────────────────────────

  async createThresholdPolicy(
    dto: CreateThresholdPolicyDto,
    actorId: string,
    actorRole: string,
  ): Promise<EscrowThresholdPolicyEntity> {
    const policy = this.policyRepo.create({
      ...dto,
      createdBy: actorId,
      isActive: true,
    });
    const saved = await this.policyRepo.save(policy);

    await this.auditLog.insert({
      actorId,
      actorRole,
      action: 'escrow.threshold-policy.created',
      resourceType: 'EscrowThresholdPolicy',
      resourceId: saved.id,
      nextValue: saved as unknown as Record<string, unknown>,
    });

    this.logger.log(`Threshold policy created: ${saved.id} by ${actorId}`);
    return saved;
  }

  async listThresholdPolicies(): Promise<EscrowThresholdPolicyEntity[]> {
    return this.policyRepo.find({ order: { createdAt: 'ASC' } });
  }

  async deactivateThresholdPolicy(
    policyId: string,
    actorId: string,
    actorRole: string,
  ): Promise<EscrowThresholdPolicyEntity> {
    const policy = await this.policyRepo.findOne({ where: { id: policyId } });
    if (!policy) throw new NotFoundException(`Policy ${policyId} not found`);

    const prev = { ...policy };
    policy.isActive = false;
    const saved = await this.policyRepo.save(policy);

    await this.auditLog.insert({
      actorId,
      actorRole,
      action: 'escrow.threshold-policy.deactivated',
      resourceType: 'EscrowThresholdPolicy',
      resourceId: policyId,
      previousValue: prev,
      nextValue: saved as unknown as Record<string, unknown>,
    });

    return saved;
  }

  /**
   * Resolve the threshold policy for a given amount.
   * Returns the matching active policy or falls back to a default (1 approval).
   */
  async resolvePolicy(amountStr: string): Promise<{
    policy: EscrowThresholdPolicyEntity | null;
    requiredApprovals: number;
    riskProfile: EscrowRiskProfile;
    expiryHours: number;
  }> {
    let amount: bigint;
    try {
      // Validate that the string contains only digits before parsing
      if (!/^[0-9]+$/.test(amountStr)) {
        throw new BadRequestException(
          'amount must be a non-negative integer string',
        );
      }
      amount = BigInt(amountStr);
    } catch (error) {
      throw new BadRequestException(
        error instanceof BadRequestException
          ? error.message
          : 'amount must be a valid non-negative integer string',
      );
    }

    const policies = await this.policyRepo.find({
      where: { isActive: true },
      order: { createdAt: 'ASC' },
    });

    for (const policy of policies) {
      const min = policy.minAmount ? BigInt(policy.minAmount) : null;
      const max = policy.maxAmount ? BigInt(policy.maxAmount) : null;

      const aboveMin = min === null || amount >= min;
      const belowMax = max === null || amount < max;

      if (aboveMin && belowMax) {
        return {
          policy,
          requiredApprovals: policy.requiredApprovals,
          riskProfile: policy.riskProfile,
          expiryHours: policy.expiryHours,
        };
      }
    }

    // Default: 1 approval, LOW risk, 24h expiry
    return {
      policy: null,
      requiredApprovals: 1,
      riskProfile: EscrowRiskProfile.LOW,
      expiryHours: 24,
    };
  }

  // ── Signer Management ────────────────────────────────────────────────────

  async addSigner(
    dto: AddSignerDto,
    actorId: string,
    actorRole: string,
  ): Promise<EscrowSignerEntity> {
    const existing = await this.signerRepo.findOne({
      where: { userId: dto.userId },
    });
    if (existing) {
      throw new ConflictException(`User ${dto.userId} is already a signer`);
    }

    const signer = this.signerRepo.create({
      userId: dto.userId,
      label: dto.label,
      status: EscrowSignerStatus.ACTIVE,
      addedBy: actorId,
    });
    const saved = await this.signerRepo.save(signer);

    await this.auditLog.insert({
      actorId,
      actorRole,
      action: 'escrow.signer.added',
      resourceType: 'EscrowSigner',
      resourceId: saved.id,
      nextValue: { userId: dto.userId, label: dto.label },
    });

    this.logger.log(`Signer added: userId=${dto.userId} by ${actorId}`);
    return saved;
  }

  async revokeSigner(
    signerId: string,
    dto: RevokeSignerDto,
    actorId: string,
    actorRole: string,
  ): Promise<EscrowSignerEntity> {
    const signer = await this.signerRepo.findOne({ where: { id: signerId } });
    if (!signer) throw new NotFoundException(`Signer ${signerId} not found`);
    if (signer.status === EscrowSignerStatus.REVOKED) {
      throw new ConflictException('Signer is already revoked');
    }

    const prev = { ...signer };
    signer.status = EscrowSignerStatus.REVOKED;
    signer.revokedBy = actorId;
    signer.revocationReason = dto.reason;
    signer.revokedAt = new Date();
    const saved = await this.signerRepo.save(signer);

    await this.auditLog.insert({
      actorId,
      actorRole,
      action: 'escrow.signer.revoked',
      resourceType: 'EscrowSigner',
      resourceId: signerId,
      previousValue: prev,
      nextValue: { status: EscrowSignerStatus.REVOKED, reason: dto.reason },
    });

    this.logger.warn(
      `Signer revoked: ${signerId} by ${actorId} — ${dto.reason}`,
    );
    return saved;
  }

  async suspendSigner(
    signerId: string,
    dto: SuspendSignerDto,
    actorId: string,
    actorRole: string,
  ): Promise<EscrowSignerEntity> {
    const signer = await this.signerRepo.findOne({ where: { id: signerId } });
    if (!signer) throw new NotFoundException(`Signer ${signerId} not found`);
    if (signer.status !== EscrowSignerStatus.ACTIVE) {
      throw new ConflictException(`Signer is already ${signer.status}`);
    }

    const prev = { ...signer };
    signer.status = EscrowSignerStatus.SUSPENDED;
    signer.revocationReason = dto.reason;
    const saved = await this.signerRepo.save(signer);

    await this.auditLog.insert({
      actorId,
      actorRole,
      action: 'escrow.signer.suspended',
      resourceType: 'EscrowSigner',
      resourceId: signerId,
      previousValue: prev,
      nextValue: { status: EscrowSignerStatus.SUSPENDED, reason: dto.reason },
    });

    this.logger.warn(
      `Signer suspended: ${signerId} by ${actorId} — ${dto.reason}`,
    );
    return saved;
  }

  async reactivateSigner(
    signerId: string,
    actorId: string,
    actorRole: string,
  ): Promise<EscrowSignerEntity> {
    const signer = await this.signerRepo.findOne({ where: { id: signerId } });
    if (!signer) throw new NotFoundException(`Signer ${signerId} not found`);
    if (signer.status === EscrowSignerStatus.REVOKED) {
      throw new ForbiddenException('Revoked signers cannot be reactivated');
    }
    if (signer.status === EscrowSignerStatus.ACTIVE) {
      throw new ConflictException('Signer is already active');
    }

    const prev = { ...signer };
    signer.status = EscrowSignerStatus.ACTIVE;
    signer.revocationReason = null;
    const saved = await this.signerRepo.save(signer);

    await this.auditLog.insert({
      actorId,
      actorRole,
      action: 'escrow.signer.reactivated',
      resourceType: 'EscrowSigner',
      resourceId: signerId,
      previousValue: prev,
      nextValue: { status: EscrowSignerStatus.ACTIVE },
    });

    return saved;
  }

  async listSigners(): Promise<EscrowSignerEntity[]> {
    return this.signerRepo.find({ order: { createdAt: 'ASC' } });
  }

  // ── Proposal Lifecycle ───────────────────────────────────────────────────

  async createProposal(
    dto: CreateEscrowProposalDto,
    proposerId: string,
    actorRole: string,
  ): Promise<EscrowProposalEntity> {
    // Prevent duplicate pending proposals for the same payment
    const existing = await this.proposalRepo.findOne({
      where: {
        paymentId: dto.paymentId,
        status: EscrowProposalStatus.PENDING,
      },
    });
    if (existing) {
      throw new ConflictException(
        `A pending escrow proposal already exists for payment ${dto.paymentId}`,
      );
    }

    // Resolve threshold policy
    const { requiredApprovals, riskProfile, expiryHours } =
      await this.resolvePolicy(dto.amount);

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + expiryHours);

    const proposal = this.proposalRepo.create({
      paymentId: dto.paymentId,
      onChainEscrowId: dto.onChainEscrowId ?? null,
      amount: dto.amount,
      riskProfile: dto.riskProfile ?? riskProfile,
      requiredApprovals,
      currentApprovals: 0,
      status: EscrowProposalStatus.PENDING,
      proposerId,
      metadata: dto.metadata ?? null,
      executionPayload: dto.executionPayload ?? null,
      expiresAt,
    });

    const saved = await this.proposalRepo.save(proposal);

    await this.auditLog.insert({
      actorId: proposerId,
      actorRole,
      action: 'escrow.proposal.created',
      resourceType: 'EscrowProposal',
      resourceId: saved.id,
      nextValue: {
        paymentId: dto.paymentId,
        amount: dto.amount,
        riskProfile: saved.riskProfile,
        requiredApprovals,
        expiresAt,
      },
    });

    this.logger.log(
      `Escrow proposal created: ${saved.id} paymentId=${dto.paymentId} ` +
        `amount=${dto.amount} requiredApprovals=${requiredApprovals}`,
    );

    return saved;
  }

  async castVote(
    proposalId: string,
    signerId: string,
    dto: CastVoteDto,
    actorRole: string,
    context?: { ipAddress?: string; userAgent?: string },
  ): Promise<EscrowProposalEntity> {
    // Verify signer is active (outside transaction — read-only fast path)
    const signer = await this.signerRepo.findOne({
      where: { userId: signerId },
    });
    if (!signer) {
      throw new ForbiddenException(
        `User ${signerId} is not a registered escrow signer`,
      );
    }
    if (signer.status !== EscrowSignerStatus.ACTIVE) {
      throw new ForbiddenException(
        `Signer ${signerId} is ${signer.status} and cannot vote`,
      );
    }

    return this.dataSource.transaction(async (manager) => {
      // Pessimistic write lock prevents concurrent lost-update on currentApprovals (#1165)
      const proposal = await manager.findOne(EscrowProposalEntity, {
        where: { id: proposalId },
        relations: ['votes'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!proposal)
        throw new NotFoundException(`Proposal ${proposalId} not found`);

      if (proposal.status !== EscrowProposalStatus.PENDING) {
        throw new ConflictException(
          `Proposal is ${proposal.status} — voting is closed`,
        );
      }
      if (new Date() > proposal.expiresAt) {
        proposal.status = EscrowProposalStatus.EXPIRED;
        await manager.save(EscrowProposalEntity, proposal);
        await this.auditLog.insert({
          actorId: signerId,
          actorRole,
          action: 'escrow.proposal.expired',
          resourceType: 'EscrowProposal',
          resourceId: proposal.id,
          nextValue: {
            status: EscrowProposalStatus.EXPIRED,
            expiredAt: new Date(),
          },
        });
        throw new ConflictException('Proposal has expired');
      }

      const existingVote = await manager.findOne(EscrowVoteEntity, {
        where: { proposalId, signerId },
      });
      if (existingVote) {
        throw new ConflictException(
          `Signer ${signerId} has already voted on proposal ${proposalId}`,
        );
      }

      if (proposal.proposerId === signerId) {
        throw new ForbiddenException(
          'Proposer cannot vote on their own proposal',
        );
      }

      const vote = manager.create(EscrowVoteEntity, {
        proposalId,
        signerId,
        decision: dto.decision,
        comment: dto.comment ?? null,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
      });
      await manager.save(EscrowVoteEntity, vote);

      await this.auditLog.insert({
        actorId: signerId,
        actorRole,
        action: 'escrow.vote.cast',
        resourceType: 'EscrowProposal',
        resourceId: proposalId,
        nextValue: { decision: dto.decision, comment: dto.comment },
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      if (dto.decision === EscrowVoteDecision.REJECT) {
        proposal.status = EscrowProposalStatus.REJECTED;
        const saved = await manager.save(EscrowProposalEntity, proposal);

        await this.auditLog.insert({
          actorId: signerId,
          actorRole,
          action: 'escrow.proposal.rejected',
          resourceType: 'EscrowProposal',
          resourceId: proposalId,
          nextValue: {
            status: EscrowProposalStatus.REJECTED,
            rejectedBy: signerId,
          },
        });

        this.eventEmitter.emit(
          'escrow.proposal.rejected',
          new EscrowProposalRejectedEvent(saved),
        );
        this.logger.warn(
          `Escrow proposal ${proposalId} REJECTED by ${signerId}`,
        );
        return saved;
      }

      // APPROVE — increment on the locked row; no concurrent lost-update risk
      proposal.currentApprovals += 1;

      if (proposal.currentApprovals >= proposal.requiredApprovals) {
        proposal.status = EscrowProposalStatus.APPROVED;
        const saved = await manager.save(EscrowProposalEntity, proposal);

        await this.auditLog.insert({
          actorId: signerId,
          actorRole,
          action: 'escrow.proposal.approved',
          resourceType: 'EscrowProposal',
          resourceId: proposalId,
          nextValue: {
            status: EscrowProposalStatus.APPROVED,
            currentApprovals: saved.currentApprovals,
            requiredApprovals: saved.requiredApprovals,
          },
        });

        this.eventEmitter.emit(
          'escrow.proposal.approved',
          new EscrowProposalApprovedEvent(saved),
        );
        this.logger.log(
          `Escrow proposal ${proposalId} APPROVED — threshold reached (${saved.currentApprovals}/${saved.requiredApprovals})`,
        );
        return saved;
      }

      const saved = await manager.save(EscrowProposalEntity, proposal);
      this.logger.log(
        `Vote recorded on proposal ${proposalId}: ${dto.decision} by ${signerId} ` +
          `(${saved.currentApprovals}/${saved.requiredApprovals})`,
      );
      return saved;
    });
  }

  async cancelProposal(
    proposalId: string,
    dto: CancelProposalDto,
    actorId: string,
    actorRole: string,
  ): Promise<EscrowProposalEntity> {
    const proposal = await this.proposalRepo.findOne({
      where: { id: proposalId },
    });
    if (!proposal)
      throw new NotFoundException(`Proposal ${proposalId} not found`);

    if (
      proposal.status !== EscrowProposalStatus.PENDING &&
      proposal.status !== EscrowProposalStatus.APPROVED
    ) {
      throw new ConflictException(
        `Cannot cancel a proposal with status ${proposal.status}`,
      );
    }

    const prev = { status: proposal.status };
    proposal.status = EscrowProposalStatus.CANCELLED;
    proposal.cancellationReason = dto.reason;
    proposal.cancelledBy = actorId;
    const saved = await this.proposalRepo.save(proposal);

    await this.auditLog.insert({
      actorId,
      actorRole,
      action: 'escrow.proposal.cancelled',
      resourceType: 'EscrowProposal',
      resourceId: proposalId,
      previousValue: prev,
      nextValue: { status: EscrowProposalStatus.CANCELLED, reason: dto.reason },
    });

    this.logger.warn(
      `Escrow proposal ${proposalId} CANCELLED by ${actorId}: ${dto.reason}`,
    );
    return saved;
  }

  async emergencySuspendProposal(
    proposalId: string,
    reason: string,
    actorId: string,
    actorRole: string,
  ): Promise<EscrowProposalEntity> {
    const proposal = await this.proposalRepo.findOne({
      where: { id: proposalId },
    });
    if (!proposal)
      throw new NotFoundException(`Proposal ${proposalId} not found`);

    if (proposal.status === EscrowProposalStatus.EXECUTED) {
      throw new ConflictException(
        'Cannot suspend an already-executed proposal',
      );
    }

    const prev = { status: proposal.status };
    proposal.status = EscrowProposalStatus.SUSPENDED;
    proposal.cancellationReason = reason;
    proposal.cancelledBy = actorId;
    const saved = await this.proposalRepo.save(proposal);

    await this.auditLog.insert({
      actorId,
      actorRole,
      action: 'escrow.proposal.emergency-suspended',
      resourceType: 'EscrowProposal',
      resourceId: proposalId,
      previousValue: prev,
      nextValue: { status: EscrowProposalStatus.SUSPENDED, reason },
    });

    this.logger.warn(
      `EMERGENCY SUSPENSION: Escrow proposal ${proposalId} suspended by ${actorId}: ${reason}`,
    );
    return saved;
  }

  /**
   * Mark a proposal as executed after the on-chain transaction completes.
   * Called by the approval listener or an external webhook handler.
   */
  async markExecuted(
    proposalId: string,
    txHash: string,
    actorId: string,
    actorRole: string,
  ): Promise<EscrowProposalEntity> {
    const proposal = await this.proposalRepo.findOne({
      where: { id: proposalId },
    });
    if (!proposal)
      throw new NotFoundException(`Proposal ${proposalId} not found`);

    if (proposal.status !== EscrowProposalStatus.APPROVED) {
      throw new ConflictException(
        `Proposal must be APPROVED before execution (current: ${proposal.status})`,
      );
    }

    proposal.status = EscrowProposalStatus.EXECUTED;
    proposal.executionTxHash = txHash;
    proposal.executedAt = new Date();
    const saved = await this.proposalRepo.save(proposal);

    await this.auditLog.insert({
      actorId,
      actorRole,
      action: 'escrow.proposal.executed',
      resourceType: 'EscrowProposal',
      resourceId: proposalId,
      nextValue: { txHash, executedAt: saved.executedAt },
    });

    this.eventEmitter.emit(
      'escrow.proposal.executed',
      new EscrowProposalExecutedEvent(saved, txHash),
    );

    this.logger.log(
      `Escrow proposal ${proposalId} EXECUTED — txHash=${txHash}`,
    );
    return saved;
  }

  // ── Query Methods ────────────────────────────────────────────────────────

  async getProposal(proposalId: string): Promise<EscrowProposalEntity> {
    const proposal = await this.proposalRepo.findOne({
      where: { id: proposalId },
      relations: ['votes'],
    });
    if (!proposal)
      throw new NotFoundException(`Proposal ${proposalId} not found`);
    return proposal;
  }

  async listProposals(filters?: {
    status?: EscrowProposalStatus;
    paymentId?: string;
  }): Promise<EscrowProposalEntity[]> {
    const where: Record<string, unknown> = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.paymentId) where.paymentId = filters.paymentId;

    return this.proposalRepo.find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['votes'],
    });
  }

  async getProposalHistory(paymentId: string): Promise<EscrowProposalEntity[]> {
    return this.proposalRepo.find({
      where: { paymentId },
      order: { createdAt: 'DESC' },
      relations: ['votes'],
    });
  }

  // ── Scheduled: Auto-expire stalled proposals ─────────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireStalledProposals(): Promise<void> {
    const stalled = await this.proposalRepo.find({
      where: {
        status: EscrowProposalStatus.PENDING,
        expiresAt: LessThan(new Date()),
      },
    });

    if (stalled.length === 0) return;

    this.logger.log(
      `Auto-expiring ${stalled.length} stalled escrow proposal(s)`,
    );

    for (const proposal of stalled) {
      await this.expireProposal(proposal, 'system', 'system');
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async expireProposal(
    proposal: EscrowProposalEntity,
    actorId: string,
    actorRole: string,
  ): Promise<void> {
    proposal.status = EscrowProposalStatus.EXPIRED;
    await this.proposalRepo.save(proposal);

    await this.auditLog.insert({
      actorId,
      actorRole,
      action: 'escrow.proposal.expired',
      resourceType: 'EscrowProposal',
      resourceId: proposal.id,
      nextValue: {
        status: EscrowProposalStatus.EXPIRED,
        expiredAt: new Date(),
      },
    });

    this.logger.warn(
      `Escrow proposal ${proposal.id} EXPIRED (paymentId=${proposal.paymentId})`,
    );
  }
}
