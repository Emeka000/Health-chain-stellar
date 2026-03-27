import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';
import { ReputationEventType } from '../enums/reputation-event-type.enum';

import { ReputationEntity } from './reputation.entity';

@Entity('reputation_history')
@Index(['reputationId'])
export class ReputationHistoryEntity extends BaseEntity {
  @Column({ name: 'reputation_id' })
  reputationId: string;

  @ManyToOne(() => ReputationEntity)
  @JoinColumn({ name: 'reputation_id' })
  reputation: ReputationEntity;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType: ReputationEventType;

  @Column({ name: 'points_delta', type: 'float' })
  pointsDelta: number;

  @Column({ name: 'score_after', type: 'float' })
  scoreAfter: number;

  @Column({ name: 'reference_id', nullable: true })
  referenceId: string;

  @Column({ name: 'note', nullable: true })
  note: string;
}
