import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

import { EscrowSignerStatus } from '../enums/escrow-governance.enum';

/**
 * Authorized signers for escrow release governance.
 * Signer rotation is supported: revoking a signer does NOT invalidate
 * already-finalized proposals (votes are immutable once cast).
 */
@Entity('escrow_signers')
@Index('IDX_ESCROW_SIGNER_USER', ['userId'], { unique: true })
@Index('IDX_ESCROW_SIGNER_STATUS', ['status'])
export class EscrowSignerEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** References the platform user who acts as a signer. */
    @Column({ name: 'user_id', type: 'varchar', length: 64 })
    userId: string;

    /** Human-readable label (e.g. "Finance Lead", "Compliance Officer"). */
    @Column({ name: 'label', type: 'varchar', length: 128 })
    label: string;

    @Column({
        type: 'varchar',
        length: 32,
        default: EscrowSignerStatus.ACTIVE,
    })
    status: EscrowSignerStatus;

    /** Actor who added this signer (for audit trail). */
    @Column({ name: 'added_by', type: 'varchar', length: 64 })
    addedBy: string;

    /** Actor who revoked this signer, if applicable. */
    @Column({ name: 'revoked_by', type: 'varchar', length: 64, nullable: true })
    revokedBy: string | null;

    /** Reason for revocation or suspension. */
    @Column({ name: 'revocation_reason', type: 'text', nullable: true })
    revocationReason: string | null;

    @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
    revokedAt: Date | null;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
