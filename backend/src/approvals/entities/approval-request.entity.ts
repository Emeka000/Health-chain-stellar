import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, ManyToOne, Index } from 'typeorm';
import { UserEntity } from '../../users/entities/user.entity';
import { ApprovalStatus, ApprovalActionType } from '../enums/approval.enum';
import { ApprovalDecisionEntity } from './approval-decision.entity';

@Entity('approval_requests')
@Index('IDX_APPROVAL_REQUEST_STATUS', ['status'])
@Index('IDX_APPROVAL_REQUEST_TARGET', ['targetId', 'actionType'])
export class ApprovalRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  targetId: string;

  @Column({
    type: 'enum',
    enum: ApprovalActionType,
  })
  actionType: ApprovalActionType;

  @Column({
    type: 'enum',
    enum: ApprovalStatus,
    default: ApprovalStatus.PENDING,
  })
  status: ApprovalStatus;

  @Column({ type: 'int', default: 1 })
  requiredApprovals: number;

  @Column({ type: 'int', default: 0 })
  currentApprovals: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata: any;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt: Date;

  @ManyToOne(() => UserEntity)
  requester: UserEntity;

  @Column()
  requesterId: string;

  @OneToMany(() => ApprovalDecisionEntity, (decision) => decision.request)
  decisions: ApprovalDecisionEntity[];

  @Column({ type: 'text', nullable: true })
  finalPayload: string; // Serialized actual payload to execute after approval
}
