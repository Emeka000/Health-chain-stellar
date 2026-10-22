import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

/**
 * The `pg` driver returns DECIMAL/NUMERIC columns as strings. Without a
 * transformer, arithmetic like `a + b` concatenates instead of adding.
 * This coerces values back to numbers on read.
 */
const numericTransformer = {
    to: (value: number | null | undefined) => value,
    from: (value: string | null) => (value === null ? null : Number(value)),
};

export enum UrgencyTier {
    STANDARD = 'standard',
    URGENT = 'urgent',
    EMERGENCY = 'emergency',
}

export enum DistanceBracket {
    SHORT = 'short', // <10km
    MEDIUM = 'medium', // 10-50km
    LONG = 'long', // >50km
}

export enum ServiceLevel {
    BASIC = 'basic',
    PREMIUM = 'premium',
}

@Entity('fee_policies')
@Index('idx_policy_match', ['geographyCode', 'urgencyTier', 'minDistanceKm', 'serviceLevel', 'effectiveFrom'])
export class FeePolicyEntity extends BaseEntity {
    // id inherited from BaseEntity

    @Column({ length: 10 })
    geographyCode: string; // e.g. 'LAG', 'ABJ'

    @Column({
        type: 'enum',
        enum: UrgencyTier,
    })
    urgencyTier: UrgencyTier;

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0, transformer: numericTransformer })
    minDistanceKm: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true, transformer: numericTransformer })
    maxDistanceKm?: number;

    @Column({
        type: 'enum',
        enum: ServiceLevel,
    })
    serviceLevel: ServiceLevel;

    @Column({ type: 'decimal', precision: 8, scale: 4, default: 0, transformer: numericTransformer })
    deliveryFeeRate: number; // % of base

    @Column({ type: 'decimal', precision: 5, scale: 4, default: 0, transformer: numericTransformer })
    platformFeePct: number; // % of delivery fee

    @Column({ type: 'decimal', precision: 8, scale: 4, default: 0, transformer: numericTransformer })
    performanceMultiplier: number; // per km

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: numericTransformer })
    fixedFee: number; // flat fee

    @Column({ nullable: true })
    waivedFor: string; // partner ID or 'emergency'

    @Column({ default: 1 })
    priority: number; // higher first for matching

    @Column({ name: 'effective_from', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    effectiveFrom: Date;

    @Column({ name: 'effective_to', type: 'timestamp', nullable: true })
    effectiveTo?: Date;
}
