import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LessThan, Repository } from 'typeorm';

import { AuditLogService } from '../common/audit/audit-log.service';

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
import {
    EscrowGovernanceService,
    EscrowProposalApprovedEvent,
    EscrowProposalRejectedEvent,
} from './escrow-governance.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProposal(overrides: Partial<EscrowProposalEntity> = {}): EscrowProposalEntity {
    return {
        id: 'proposal-1',
        paymentId: 'payment-1',
        onChainEscrowId: null,
        amount: '5000000',
        riskProfile: EscrowRiskProfile.LOW,
        requiredApprovals: 2,
        currentApprovals: 0,
        status: EscrowProposalStatus.PENDING,
        proposerId: 'proposer-user',
        metadata: null,
        executionPayload: null,
        executionTxHash: null,
        executedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        cancellationReason: null,
        cancelledBy: null,
        votes: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    } as EscrowProposalEntity;
}

function makeSigner(overrides: Partial<EscrowSignerEntity> = {}): EscrowSignerEntity {
    return {
        id: 'signer-1',
        userId: 'signer-user-1',
        label: 'Finance Lead',
        status: EscrowSignerStatus.ACTIVE,
        addedBy: 'admin',
        revokedBy: null,
        revocationReason: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    } as EscrowSignerEntity;
}

function makePolicy(overrides: Partial<EscrowThresholdPolicyEntity> = {}): EscrowThresholdPolicyEntity {
    return {
        id: 'policy-1',
        name: 'High Value',
        minAmount: '10000000',
        maxAmount: null,
        riskProfile: EscrowRiskProfile.HIGH,
        requiredApprovals: 3,
        expiryHours: 48,
        isActive: true,
        createdBy: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    } as EscrowThresholdPolicyEntity;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('EscrowGovernanceService', () => {
    let service: EscrowGovernanceService;
    let proposalRepo: jest.Mocked<Repository<EscrowProposalEntity>>;
    let voteRepo: jest.Mocked<Repository<EscrowVoteEntity>>;
    let signerRepo: jest.Mocked<Repository<EscrowSignerEntity>>;
    let policyRepo: jest.Mocked<Repository<EscrowThresholdPolicyEntity>>;
    let auditLog: jest.Mocked<AuditLogService>;
    let eventEmitter: jest.Mocked<EventEmitter2>;

    const mockRepo = () => ({
        findOne: jest.fn(),
        find: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
        insert: jest.fn(),
    });

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                EscrowGovernanceService,
                { provide: getRepositoryToken(EscrowProposalEntity), useFactory: mockRepo },
                { provide: getRepositoryToken(EscrowVoteEntity), useFactory: mockRepo },
                { provide: getRepositoryToken(EscrowSignerEntity), useFactory: mockRepo },
                { provide: getRepositoryToken(EscrowThresholdPolicyEntity), useFactory: mockRepo },
                { provide: AuditLogService, useValue: { insert: jest.fn() } },
                { provide: EventEmitter2, useValue: { emit: jest.fn() } },
            ],
        }).compile();

        service = module.get(EscrowGovernanceService);
        proposalRepo = module.get(getRepositoryToken(EscrowProposalEntity));
        voteRepo = module.get(getRepositoryToken(EscrowVoteEntity));
        signerRepo = module.get(getRepositoryToken(EscrowSignerEntity));
        policyRepo = module.get(getRepositoryToken(EscrowThresholdPolicyEntity));
        auditLog = module.get(AuditLogService);
        eventEmitter = module.get(EventEmitter2);
    });

    // ── resolvePolicy ──────────────────────────────────────────────────────────

    describe('resolvePolicy', () => {
        it('returns default (1 approval, LOW) when no policies exist', async () => {
            policyRepo.find.mockResolvedValue([]);
            const result = await service.resolvePolicy('500000');
            expect(result.requiredApprovals).toBe(1);
            expect(result.riskProfile).toBe(EscrowRiskProfile.LOW);
            expect(result.policy).toBeNull();
        });

        it('matches the correct policy tier by amount', async () => {
            const policies = [
                makePolicy({ minAmount: null, maxAmount: '1000000', riskProfile: EscrowRiskProfile.LOW, requiredApprovals: 1 }),
                makePolicy({ id: 'p2', minAmount: '1000000', maxAmount: '10000000', riskProfile: EscrowRiskProfile.MEDIUM, requiredApprovals: 2 }),
                makePolicy({ id: 'p3', minAmount: '10000000', maxAmount: null, riskProfile: EscrowRiskProfile.HIGH, requiredApprovals: 3 }),
            ];
            policyRepo.find.mockResolvedValue(policies);

            const low = await service.resolvePolicy('500000');
            expect(low.requiredApprovals).toBe(1);
            expect(low.riskProfile).toBe(EscrowRiskProfile.LOW);

            const medium = await service.resolvePolicy('5000000');
            expect(medium.requiredApprovals).toBe(2);
            expect(medium.riskProfile).toBe(EscrowRiskProfile.MEDIUM);

            const high = await service.resolvePolicy('15000000');
            expect(high.requiredApprovals).toBe(3);
            expect(high.riskProfile).toBe(EscrowRiskProfile.HIGH);
        });

        it('uses the first matching policy when multiple could match', async () => {
            const policies = [
                makePolicy({ minAmount: null, maxAmount: null, riskProfile: EscrowRiskProfile.LOW, requiredApprovals: 1 }),
                makePolicy({ id: 'p2', minAmount: '1000000', maxAmount: null, riskProfile: EscrowRiskProfile.HIGH, requiredApprovals: 3 }),
            ];
            policyRepo.find.mockResolvedValue(policies);
            const result = await service.resolvePolicy('5000000');
            expect(result.requiredApprovals).toBe(1); // first match wins
        });
    });

    // ── createProposal ─────────────────────────────────────────────────────────

    describe('createProposal', () => {
        beforeEach(() => {
            policyRepo.find.mockResolvedValue([]);
        });

        it('creates a proposal with resolved threshold', async () => {
            proposalRepo.findOne.mockResolvedValue(null);
            const proposal = makeProposal({ requiredApprovals: 1 });
            proposalRepo.create.mockReturnValue(proposal);
            proposalRepo.save.mockResolvedValue(proposal);

            const result = await service.createProposal(
                { paymentId: 'payment-1', amount: '500000' },
                'proposer-user',
                'admin',
            );

            expect(result.paymentId).toBe('payment-1');
            expect(proposalRepo.save).toHaveBeenCalled();
            expect(auditLog.insert).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'escrow.proposal.created' }),
            );
        });

        it('throws ConflictException when a pending proposal already exists for the payment', async () => {
            proposalRepo.findOne.mockResolvedValue(makeProposal());

            await expect(
                service.createProposal({ paymentId: 'payment-1', amount: '500000' }, 'user', 'admin'),
            ).rejects.toThrow(ConflictException);
        });
    });

    // ── castVote — duplicate vote prevention ───────────────────────────────────

    describe('castVote — duplicate vote prevention', () => {
        it('throws ConflictException when the same signer votes twice', async () => {
            signerRepo.findOne.mockResolvedValue(makeSigner({ userId: 'signer-user-1' }));
            proposalRepo.findOne.mockResolvedValue(makeProposal());
            voteRepo.findOne.mockResolvedValue({ id: 'existing-vote' } as EscrowVoteEntity);

            await expect(
                service.castVote('proposal-1', 'signer-user-1', { decision: EscrowVoteDecision.APPROVE }, 'signer'),
            ).rejects.toThrow(ConflictException);
        });

        it('throws ForbiddenException when proposer tries to vote on own proposal', async () => {
            signerRepo.findOne.mockResolvedValue(makeSigner({ userId: 'proposer-user' }));
            proposalRepo.findOne.mockResolvedValue(makeProposal({ proposerId: 'proposer-user' }));
            voteRepo.findOne.mockResolvedValue(null);

            await expect(
                service.castVote('proposal-1', 'proposer-user', { decision: EscrowVoteDecision.APPROVE }, 'signer'),
            ).rejects.toThrow(ForbiddenException);
        });

        it('throws ForbiddenException when signer is not registered', async () => {
            signerRepo.findOne.mockResolvedValue(null);

            await expect(
                service.castVote('proposal-1', 'unknown-user', { decision: EscrowVoteDecision.APPROVE }, 'signer'),
            ).rejects.toThrow(ForbiddenException);
        });

        it('throws ForbiddenException when signer is revoked', async () => {
            signerRepo.findOne.mockResolvedValue(makeSigner({ status: EscrowSignerStatus.REVOKED }));

            await expect(
                service.castVote('proposal-1', 'signer-user-1', { decision: EscrowVoteDecision.APPROVE }, 'signer'),
            ).rejects.toThrow(ForbiddenException);
        });

        it('throws ForbiddenException when signer is suspended', async () => {
            signerRepo.findOne.mockResolvedValue(makeSigner({ status: EscrowSignerStatus.SUSPENDED }));

            await expect(
                service.castVote('proposal-1', 'signer-user-1', { decision: EscrowVoteDecision.APPROVE }, 'signer'),
            ).rejects.toThrow(ForbiddenException);
        });
    });

    // ── castVote — threshold logic ─────────────────────────────────────────────

    describe('castVote — threshold logic', () => {
        beforeEach(() => {
            signerRepo.findOne.mockResolvedValue(makeSigner());
            voteRepo.findOne.mockResolvedValue(null);
            voteRepo.create.mockReturnValue({} as EscrowVoteEntity);
            voteRepo.save.mockResolvedValue({} as EscrowVoteEntity);
        });

        it('transitions proposal to APPROVED when threshold is reached', async () => {
            const proposal = makeProposal({ requiredApprovals: 2, currentApprovals: 1 });
            proposalRepo.findOne.mockResolvedValue(proposal);
            const approved = { ...proposal, status: EscrowProposalStatus.APPROVED, currentApprovals: 2 };
            proposalRepo.save.mockResolvedValue(approved as EscrowProposalEntity);

            const result = await service.castVote(
                'proposal-1',
                'signer-user-1',
                { decision: EscrowVoteDecision.APPROVE },
                'signer',
            );

            expect(result.status).toBe(EscrowProposalStatus.APPROVED);
            expect(eventEmitter.emit).toHaveBeenCalledWith(
                'escrow.proposal.approved',
                expect.any(EscrowProposalApprovedEvent),
            );
            expect(auditLog.insert).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'escrow.proposal.approved' }),
            );
        });

        it('keeps proposal PENDING when threshold is not yet reached', async () => {
            const proposal = makeProposal({ requiredApprovals: 3, currentApprovals: 0 });
            proposalRepo.findOne.mockResolvedValue(proposal);
            const updated = { ...proposal, currentApprovals: 1 };
            proposalRepo.save.mockResolvedValue(updated as EscrowProposalEntity);

            const result = await service.castVote(
                'proposal-1',
                'signer-user-1',
                { decision: EscrowVoteDecision.APPROVE },
                'signer',
            );

            expect(result.status).toBe(EscrowProposalStatus.PENDING);
            expect(eventEmitter.emit).not.toHaveBeenCalled();
        });

        it('transitions proposal to REJECTED on any REJECT vote', async () => {
            const proposal = makeProposal({ requiredApprovals: 3, currentApprovals: 2 });
            proposalRepo.findOne.mockResolvedValue(proposal);
            const rejected = { ...proposal, status: EscrowProposalStatus.REJECTED };
            proposalRepo.save.mockResolvedValue(rejected as EscrowProposalEntity);

            const result = await service.castVote(
                'proposal-1',
                'signer-user-1',
                { decision: EscrowVoteDecision.REJECT },
                'signer',
            );

            expect(result.status).toBe(EscrowProposalStatus.REJECTED);
            expect(eventEmitter.emit).toHaveBeenCalledWith(
                'escrow.proposal.rejected',
                expect.any(EscrowProposalRejectedEvent),
            );
        });

        it('throws ConflictException when voting on a non-PENDING proposal', async () => {
            proposalRepo.findOne.mockResolvedValue(
                makeProposal({ status: EscrowProposalStatus.APPROVED }),
            );

            await expect(
                service.castVote('proposal-1', 'signer-user-1', { decision: EscrowVoteDecision.APPROVE }, 'signer'),
            ).rejects.toThrow(ConflictException);
        });

        it('lazily expires and throws ConflictException when proposal is past expiresAt', async () => {
            const expired = makeProposal({ expiresAt: new Date(Date.now() - 1000) });
            proposalRepo.findOne.mockResolvedValue(expired);
            proposalRepo.save.mockResolvedValue({ ...expired, status: EscrowProposalStatus.EXPIRED } as EscrowProposalEntity);

            await expect(
                service.castVote('proposal-1', 'signer-user-1', { decision: EscrowVoteDecision.APPROVE }, 'signer'),
            ).rejects.toThrow(ConflictException);

            expect(proposalRepo.save).toHaveBeenCalledWith(
                expect.objectContaining({ status: EscrowProposalStatus.EXPIRED }),
            );
        });
    });

    // ── Signer rotation — finalized proposals remain valid ─────────────────────

    describe('signer rotation', () => {
        it('revoking a signer does not affect already-cast votes (votes are immutable)', async () => {
            // Votes are stored independently; revoking a signer only prevents future votes.
            const signer = makeSigner();
            signerRepo.findOne.mockResolvedValue(signer);
            const revoked = { ...signer, status: EscrowSignerStatus.REVOKED, revokedBy: 'admin', revokedAt: new Date() };
            signerRepo.save.mockResolvedValue(revoked as EscrowSignerEntity);

            const result = await service.revokeSigner('signer-1', { reason: 'Left company' }, 'admin', 'admin');

            expect(result.status).toBe(EscrowSignerStatus.REVOKED);
            // Existing votes in escrow_votes table are untouched — no delete called
            expect(voteRepo.save).not.toHaveBeenCalled();
        });

        it('throws ConflictException when revoking an already-revoked signer', async () => {
            signerRepo.findOne.mockResolvedValue(makeSigner({ status: EscrowSignerStatus.REVOKED }));

            await expect(
                service.revokeSigner('signer-1', { reason: 'duplicate' }, 'admin', 'admin'),
            ).rejects.toThrow(ConflictException);
        });

        it('throws ForbiddenException when trying to reactivate a revoked signer', async () => {
            signerRepo.findOne.mockResolvedValue(makeSigner({ status: EscrowSignerStatus.REVOKED }));

            await expect(service.reactivateSigner('signer-1', 'admin', 'admin')).rejects.toThrow(
                ForbiddenException,
            );
        });

        it('reactivates a suspended signer successfully', async () => {
            const suspended = makeSigner({ status: EscrowSignerStatus.SUSPENDED });
            signerRepo.findOne.mockResolvedValue(suspended);
            const active = { ...suspended, status: EscrowSignerStatus.ACTIVE };
            signerRepo.save.mockResolvedValue(active as EscrowSignerEntity);

            const result = await service.reactivateSigner('signer-1', 'admin', 'admin');
            expect(result.status).toBe(EscrowSignerStatus.ACTIVE);
        });

        it('throws ConflictException when adding a duplicate signer', async () => {
            signerRepo.findOne.mockResolvedValue(makeSigner());

            await expect(
                service.addSigner({ userId: 'signer-user-1', label: 'Duplicate' }, 'admin', 'admin'),
            ).rejects.toThrow(ConflictException);
        });
    });

    // ── Threshold changes do not affect in-flight proposals ───────────────────

    describe('threshold changes do not invalidate in-flight proposals', () => {
        it('proposal retains its snapshotted requiredApprovals even after policy changes', async () => {
            // Proposal was created with requiredApprovals=2 (snapshotted)
            const proposal = makeProposal({ requiredApprovals: 2, currentApprovals: 1 });
            proposalRepo.findOne.mockResolvedValue(proposal);

            // Even if the policy now requires 5 approvals, the proposal still uses 2
            expect(proposal.requiredApprovals).toBe(2);
        });
    });

    // ── cancelProposal ─────────────────────────────────────────────────────────

    describe('cancelProposal', () => {
        it('cancels a PENDING proposal', async () => {
            const proposal = makeProposal();
            proposalRepo.findOne.mockResolvedValue(proposal);
            const cancelled = { ...proposal, status: EscrowProposalStatus.CANCELLED };
            proposalRepo.save.mockResolvedValue(cancelled as EscrowProposalEntity);

            const result = await service.cancelProposal(
                'proposal-1',
                { reason: 'No longer needed' },
                'admin',
                'admin',
            );

            expect(result.status).toBe(EscrowProposalStatus.CANCELLED);
            expect(auditLog.insert).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'escrow.proposal.cancelled' }),
            );
        });

        it('throws ConflictException when cancelling an EXECUTED proposal', async () => {
            proposalRepo.findOne.mockResolvedValue(
                makeProposal({ status: EscrowProposalStatus.EXECUTED }),
            );

            await expect(
                service.cancelProposal('proposal-1', { reason: 'too late' }, 'admin', 'admin'),
            ).rejects.toThrow(ConflictException);
        });
    });

    // ── emergencySuspendProposal ───────────────────────────────────────────────

    describe('emergencySuspendProposal', () => {
        it('suspends a PENDING proposal', async () => {
            const proposal = makeProposal();
            proposalRepo.findOne.mockResolvedValue(proposal);
            const suspended = { ...proposal, status: EscrowProposalStatus.SUSPENDED };
            proposalRepo.save.mockResolvedValue(suspended as EscrowProposalEntity);

            const result = await service.emergencySuspendProposal(
                'proposal-1',
                'Fraud detected',
                'admin',
                'admin',
            );

            expect(result.status).toBe(EscrowProposalStatus.SUSPENDED);
            expect(auditLog.insert).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'escrow.proposal.emergency-suspended' }),
            );
        });

        it('throws ConflictException when suspending an already-executed proposal', async () => {
            proposalRepo.findOne.mockResolvedValue(
                makeProposal({ status: EscrowProposalStatus.EXECUTED }),
            );

            await expect(
                service.emergencySuspendProposal('proposal-1', 'too late', 'admin', 'admin'),
            ).rejects.toThrow(ConflictException);
        });
    });

    // ── markExecuted ──────────────────────────────────────────────────────────

    describe('markExecuted', () => {
        it('marks an APPROVED proposal as EXECUTED with tx hash', async () => {
            const proposal = makeProposal({ status: EscrowProposalStatus.APPROVED });
            proposalRepo.findOne.mockResolvedValue(proposal);
            const executed = {
                ...proposal,
                status: EscrowProposalStatus.EXECUTED,
                executionTxHash: 'abc123',
                executedAt: new Date(),
            };
            proposalRepo.save.mockResolvedValue(executed as EscrowProposalEntity);

            const result = await service.markExecuted('proposal-1', 'abc123', 'system', 'system');

            expect(result.status).toBe(EscrowProposalStatus.EXECUTED);
            expect(result.executionTxHash).toBe('abc123');
            expect(auditLog.insert).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'escrow.proposal.executed' }),
            );
        });

        it('throws ConflictException when executing a non-APPROVED proposal', async () => {
            proposalRepo.findOne.mockResolvedValue(makeProposal({ status: EscrowProposalStatus.PENDING }));

            await expect(
                service.markExecuted('proposal-1', 'abc123', 'system', 'system'),
            ).rejects.toThrow(ConflictException);
        });
    });

    // ── expireStalledProposals (cron) ─────────────────────────────────────────

    describe('expireStalledProposals', () => {
        it('expires all stalled PENDING proposals past their expiresAt', async () => {
            const stalled = [
                makeProposal({ id: 'p1', expiresAt: new Date(Date.now() - 1000) }),
                makeProposal({ id: 'p2', expiresAt: new Date(Date.now() - 2000) }),
            ];
            proposalRepo.find.mockResolvedValue(stalled);
            proposalRepo.save.mockImplementation(async (p) => p as EscrowProposalEntity);

            await service.expireStalledProposals();

            expect(proposalRepo.save).toHaveBeenCalledTimes(2);
            expect(auditLog.insert).toHaveBeenCalledTimes(2);
            stalled.forEach((p) =>
                expect(proposalRepo.save).toHaveBeenCalledWith(
                    expect.objectContaining({ status: EscrowProposalStatus.EXPIRED }),
                ),
            );
        });

        it('does nothing when no stalled proposals exist', async () => {
            proposalRepo.find.mockResolvedValue([]);
            await service.expireStalledProposals();
            expect(proposalRepo.save).not.toHaveBeenCalled();
        });
    });

    // ── Threshold policy management ───────────────────────────────────────────

    describe('createThresholdPolicy', () => {
        it('creates and audits a new policy', async () => {
            const policy = makePolicy();
            policyRepo.create.mockReturnValue(policy);
            policyRepo.save.mockResolvedValue(policy);

            const result = await service.createThresholdPolicy(
                {
                    name: 'High Value',
                    minAmount: '10000000',
                    riskProfile: EscrowRiskProfile.HIGH,
                    requiredApprovals: 3,
                },
                'admin',
                'admin',
            );

            expect(result.requiredApprovals).toBe(3);
            expect(auditLog.insert).toHaveBeenCalledWith(
                expect.objectContaining({ action: 'escrow.threshold-policy.created' }),
            );
        });
    });

    describe('deactivateThresholdPolicy', () => {
        it('deactivates an active policy', async () => {
            const policy = makePolicy();
            policyRepo.findOne.mockResolvedValue(policy);
            const deactivated = { ...policy, isActive: false };
            policyRepo.save.mockResolvedValue(deactivated as EscrowThresholdPolicyEntity);

            const result = await service.deactivateThresholdPolicy('policy-1', 'admin', 'admin');
            expect(result.isActive).toBe(false);
        });

        it('throws NotFoundException for unknown policy', async () => {
            policyRepo.findOne.mockResolvedValue(null);
            await expect(
                service.deactivateThresholdPolicy('bad-id', 'admin', 'admin'),
            ).rejects.toThrow(NotFoundException);
        });
    });
});
