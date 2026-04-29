import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from 'typeorm';

import { EscrowRiskProfile } from '../enums/escrow-governance.enum';

/**
 * Configurable threshold policy: maps a payment amount range + risk profile
 * to the number of signer approvals required before escrow release.
 *
 * Policies are evaluated at proposal creation time. Changing a policy
 * does NOT affect already-created proposals (threshold is snapshotted).
 *
 * Example:
 *   amount < 1_000_000 stroops  → LOW risk  → 1 approval
 *   amount < 10_000_000 stroops → MEDIUM    → 2 approvals
 *   amount >= 10_000_000 stroops → HIGH     → 3 approvals
 */
@Entity('escrow_threshold_policies')
@Index('IDX_ESCROW_POLICY_RISK', ['riskProfile'])
@Index('IDX_ESCROW_POLICY_ACTIVE', ['isActive'])
export class EscrowThresholdPolicyEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    /** Human-readable name for this policy tier. */
    @Column({ name: 'name', type: 'varchar', length: 128 })
    name: string;

    /** Minimum payment amount (inclusive) in stroops. NULL = no lower bound. */
    @Column({ name: 'min_amount', type: 'bigint', nullable: true })
    minAmount: string | null;

    /** Maximum payment amount (exclusive) in stroops. NULL = no upper bound. */
    @Column({ name: 'max_amount', type: 'bigint', nullable: true })
    maxAmount: string | null;

    @Column({
        name: 'risk_profile',
        type: 'varchar',
        length: 32,
    })
    riskProfile: EscrowRiskProfile;

    /** Number of signer approvals required for this tier. */
    @Column({ name: 'required_approvals', type: 'int' })
    requiredApprovals: number;

    /** Proposal TTL in hours before auto-expiry. */
    @Column({ name: 'expiry_hours', type: 'int', default: 24 })
    expiryHours: number;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;

    /** Actor who created this policy. */
    @Column({ name: 'created_by', type: 'varchar', length: 64 })
    createdBy: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
