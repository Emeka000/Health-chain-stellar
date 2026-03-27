import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';
import { RiderEntity } from '../../riders/entities/rider.entity';
import { BadgeType } from '../enums/badge-type.enum';

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
}
