import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';
import { RequestStatus } from '../enums/blood-request-status.enum';

import { BloodRequestEntity } from './blood-request.entity';

@Entity('request_status_history')
@Index('IDX_REQUEST_STATUS_HISTORY_REQUEST_ID', ['requestId'])
@Index('IDX_REQUEST_STATUS_HISTORY_CREATED_AT', ['createdAt'])
export class RequestStatusHistoryEntity extends BaseEntity {
  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @ManyToOne(() => BloodRequestEntity, (request) => request.statusHistory, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'request_id' })
  request: BloodRequestEntity;

  @Column({
    name: 'previous_status',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  previousStatus: RequestStatus | null;

  @Column({ name: 'new_status', type: 'varchar', length: 32 })
  newStatus: RequestStatus;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({
    name: 'changed_by_user_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  changedByUserId: string | null;
}
