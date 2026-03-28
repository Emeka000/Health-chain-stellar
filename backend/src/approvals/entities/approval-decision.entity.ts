import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, Index } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { ApprovalStatus } from '../enums/approval.enum';
import { ApprovalRequestEntity } from './approval-request.entity';

@Entity('approval_decisions')
@Index('IDX_APPROVAL_DECISION_USER_REQUEST', ['userId', 'requestId'])
export class ApprovalDecisionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => ApprovalRequestEntity, (request) => request.decisions)
  request: ApprovalRequestEntity;

  @Column()
  requestId: string;

  @ManyToOne(() => UserEntity)
  user: UserEntity;

  @Column()
  userId: string;

  @Column({
    type: 'enum',
    enum: ApprovalStatus,
    description: 'DECISION: APPROVED or REJECTED'
  })
  decision: ApprovalStatus;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ipAddress: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  userAgent: string;
}
