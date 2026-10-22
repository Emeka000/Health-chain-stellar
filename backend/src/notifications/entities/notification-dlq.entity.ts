import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { NotificationChannel } from '../enums/notification-channel.enum';

export enum DlqEntryStatus {
  PENDING = 'pending',
  REPLAYING = 'replaying',
  REPLAYED = 'replayed',
  ABANDONED = 'abandoned',
}

@Entity('notification_dlq')
@Index(['status'])
@Index(['channel'])
@Index(['recipientId'])
export class NotificationDlqEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Original notification entity id */
  @Column({ name: 'notification_id' })
  notificationId: string;

  @Column({ name: 'recipient_id' })
  recipientId: string;

  @Column({ type: 'enum', enum: NotificationChannel })
  channel: NotificationChannel;

  @Column({ name: 'template_key' })
  templateKey: string;

  @Column({ type: 'jsonb', nullable: true })
  variables: Record<string, any> | null;

  @Column({ name: 'rendered_body', type: 'text' })
  renderedBody: string;

  /** Serialised array of ProviderAttemptResult from the final failed job */
  @Column({ name: 'provider_attempts', type: 'jsonb', default: '[]' })
  providerAttempts: Record<string, any>[];

  /** Last error message */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  /** How many times this DLQ entry has been replayed */
  @Column({ name: 'replay_count', default: 0 })
  replayCount: number;

  @Column({
    type: 'enum',
    enum: DlqEntryStatus,
    default: DlqEntryStatus.PENDING,
  })
  status: DlqEntryStatus;

  /** Actor who triggered the last replay */
  @Column({ name: 'replayed_by', nullable: true })
  replayedBy: string | null;

  @Column({ name: 'replayed_at', type: 'timestamptz', nullable: true })
  replayedAt: Date | null;

  /** Optional operator note */
  @Column({ name: 'abandon_reason', type: 'text', nullable: true })
  abandonReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
