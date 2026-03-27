import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

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

    @Column({ type: 'decimal', precision: 6, scale: 2, default: 0 })
    minDistanceKm: number;

    @Column({ type: 'decimal', precision: 6, scale: 2, nullable: true })
    maxDistanceKm?: number;

    @Column({
        type: 'enum',
        enum: ServiceLevel,
    })
    serviceLevel: ServiceLevel;

    @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
    deliveryFeeRate: number; // % of base

    @Column({ type: 'decimal', precision: 5, scale: 4, default: 0 })
    platformFeePct: number; // % of delivery fee

    @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
    performanceMultiplier: number; // per km

    @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
    fixedFee: number; // flat fee

    @Column({ nullable: true })
    waivedFor: string; // partner ID or 'emergency'

    @Column({ default: 1 })
    priority: number; // higher first for matching

    @CreateDateColumn({ name: 'effective_from' })
    effectiveFrom: Date;

    @Column({ name: 'effective_to', type: 'timestamp', nullable: true })
    effectiveTo?: Date;
}
