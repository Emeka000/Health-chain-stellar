import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { NotificationCategory, EmergencyTier } from './notification-preference.entity';

@Entity('notification_fanout_attempts')
@Index(['idempotencyKey'], { unique: true })
@Index(['userId'])
export class NotificationFanoutAttemptEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'idempotency_key', unique: true })
  idempotencyKey: string;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ type: 'enum', enum: NotificationCategory })
  category: NotificationCategory;

  @Column({ type: 'enum', enum: EmergencyTier, default: EmergencyTier.NORMAL })
  emergencyTier: EmergencyTier;

  @Column({ name: 'channel_count', default: 0 })
  channelCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
