import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    OneToMany,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

import {
    EscrowProposalStatus,
    EscrowRiskProfile,
} from '../enums/escrow-governance.enum';
import { EscrowVoteEntity } from './escrow-vote.entity';

/**
 * A proposal to release (or refund) an escrow payment.
 * High-value releases require multi-signature approval before execution.
 *
 * Threshold policy is captured at proposal creation time so that
 * subsequent threshold changes do not affect in-flight proposals.
 */
@Entity('escrow_proposals')
@Index('IDX_ESCROW_PROPOSAL_PAYMENT', ['paymentId'])
@Index('IDX_ESCROW_PROPOSAL_STATUS', ['status'])
@Index('IDX_ESCROW_PROPOSAL_EXPIRES', ['expiresAt'])
export class EscrowProposalEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** Off-chain payment / order identifier this proposal targets. */
    @Column({ name: 'payment_id', type: 'varchar', length: 128 })
    paymentId: string;

    /** On-chain escrow contract identifier (Soroban contract ID). */
    @Column({ name: 'on_chain_escrow_id', type: 'varchar', length: 128, nullable: true })
    onChainEscrowId: string | null;

    /** Payment amount in the smallest unit (e.g. stroops for XLM). */
    @Column({ name: 'amount', type: 'bigint' })
    amount: string;

    /** Risk classification that determined the threshold. */
    @Column({
        name: 'risk_profile',
        type: 'varchar',
        length: 32,
        default: EscrowRiskProfile.LOW,
    })
    riskProfile: EscrowRiskProfile;

    /** Number of approvals required (snapshotted at creation). */
    @Column({ name: 'required_approvals', type: 'int' })
    requiredApprovals: number;

    /** Running count of APPROVE votes received. */
    @Column({ name: 'current_approvals', type: 'int', default: 0 })
    currentApprovals: number;

    @Column({
        name: 'status',
        type: 'varchar',
        length: 32,
        default: EscrowProposalStatus.PENDING,
    })
    status: EscrowProposalStatus;

    /** User who initiated the release proposal. */
    @Column({ name: 'proposer_id', type: 'varchar', length: 64 })
    proposerId: string;

    /** Arbitrary metadata (e.g. proof bundle ID, order ID). */
    @Column({ type: 'jsonb', nullable: true })
    metadata: Record<string, unknown> | null;

    /** Serialised payload to execute once threshold is reached. */
    @Column({ name: 'execution_payload', type: 'jsonb', nullable: true })
    executionPayload: Record<string, unknown> | null;

    /** Blockchain transaction hash after successful execution. */
    @Column({ name: 'execution_tx_hash', type: 'varchar', length: 128, nullable: true })
    executionTxHash: string | null;

    /** Timestamp when the proposal was executed on-chain. */
    @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
    executedAt: Date | null;

    /** Proposal expires at this time; stalled proposals are auto-cancelled. */
    @Column({ name: 'expires_at', type: 'timestamptz' })
    expiresAt: Date;

    /** Reason for cancellation or suspension. */
    @Column({ name: 'cancellation_reason', type: 'text', nullable: true })
    cancellationReason: string | null;

    /** Actor who cancelled or suspended the proposal. */
    @Column({ name: 'cancelled_by', type: 'varchar', length: 64, nullable: true })
    cancelledBy: string | null;

    @OneToMany(() => EscrowVoteEntity, (vote) => vote.proposal, { cascade: true })
    votes: EscrowVoteEntity[];

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
