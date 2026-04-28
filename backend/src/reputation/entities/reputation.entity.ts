import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';
import { RiderEntity } from '../../riders/entities/rider.entity';
import { BadgeType } from '../enums/badge-type.enum';
import { ConductType } from '../enums/conduct-type.enum';

export interface GoodConductRecord {
  conductType: ConductType;
  pointsAwarded: number;
  validatedAt: string;
}

@Entity('reputations')
@Index(['riderId'])
export class ReputationEntity extends BaseEntity {
  @Column({ name: 'rider_id' })
  riderId: string;

  @ManyToOne(() => RiderEntity)
  @JoinColumn({ name: 'rider_id' })
  rider: RiderEntity;

  @Column({ name: 'reputation_score', type: 'float', default: 0 })
  reputationScore: number;

  @Column({ name: 'rank', nullable: true })
  rank: number;

  @Column({ name: 'badges', type: 'simple-array', default: '' })
  badges: BadgeType[];

  @Column({ name: 'good_conduct_records', type: 'simple-json', nullable: true })
  goodConductRecords: GoodConductRecord[] | null;

  @Column({ name: 'conduct_streak', type: 'int', default: 0 })
  conductStreak: number;

  @Column({ name: 'recovery_cap_score', type: 'float', nullable: true })
  recoveryCapScore: number | null;

  @Column({ name: 'pending_violations', type: 'int', default: 0 })
  pendingViolations: number;
}
