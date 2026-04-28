import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';

import { EscrowVoteDecision } from '../enums/escrow-governance.enum';
import { EscrowProposalEntity } from './escrow-proposal.entity';

/**
 * An individual signer's vote on an escrow release proposal.
 * Votes are immutable once cast — duplicate votes from the same signer
 * are rejected at the service layer.
 *
 * Signer revocation after a vote is cast does NOT invalidate the vote;
 * already-finalized proposals remain valid.
 */
@Entity('escrow_votes')
@Index('IDX_ESCROW_VOTE_PROPOSAL_SIGNER', ['proposalId', 'signerId'], { unique: true })
@Index('IDX_ESCROW_VOTE_SIGNER', ['signerId'])
export class EscrowVoteEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => EscrowProposalEntity, (proposal) => proposal.votes)
    proposal: EscrowProposalEntity;

    @Column({ name: 'proposal_id', type: 'uuid' })
    proposalId: string;

    /** The signer's user ID (not the EscrowSignerEntity.id). */
    @Column({ name: 'signer_id', type: 'varchar', length: 64 })
    signerId: string;

    @Column({
        name: 'decision',
        type: 'varchar',
        length: 16,
    })
    decision: EscrowVoteDecision;

    /** Optional justification comment. */
    @Column({ name: 'comment', type: 'text', nullable: true })
    comment: string | null;

    /** IP address for audit trail. */
    @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
    ipAddress: string | null;

    /** User-agent for audit trail. */
    @Column({ name: 'user_agent', type: 'varchar', length: 512, nullable: true })
    userAgent: string | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
