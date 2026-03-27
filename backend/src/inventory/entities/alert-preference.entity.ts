import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { AlertType } from './inventory-alert.entity';

@Entity('alert_preferences')
@Index('idx_alert_preferences_org', ['organizationId'], { unique: true })
export class AlertPreferenceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'varchar' })
  organizationId: string;

  @Column({ name: 'low_stock_threshold', type: 'int', default: 10 })
  lowStockThreshold: number;

  @Column({ name: 'critical_stock_threshold', type: 'int', default: 5 })
  criticalStockThreshold: number;

  @Column({ name: 'expiring_soon_days', type: 'int', default: 7 })
  expiringSoonDays: number;

  @Column({ name: 'enable_low_stock_alerts', type: 'boolean', default: true })
  enableLowStockAlerts: boolean;

  @Column({ name: 'enable_expiring_alerts', type: 'boolean', default: true })
  enableExpiringAlerts: boolean;

  @Column({ name: 'enable_expired_alerts', type: 'boolean', default: true })
  enableExpiredAlerts: boolean;

  @Column({
    name: 'enable_email_notifications',
    type: 'boolean',
    default: true,
  })
  enableEmailNotifications: boolean;

  @Column({ name: 'enable_sms_notifications', type: 'boolean', default: false })
  enableSmsNotifications: boolean;

  @Column({
    name: 'enable_in_app_notifications',
    type: 'boolean',
    default: true,
  })
  enableInAppNotifications: boolean;

  @Column({ name: 'notification_emails', type: 'simple-array', nullable: true })
  notificationEmails: string[] | null;

  @Column({ name: 'notification_phones', type: 'simple-array', nullable: true })
  notificationPhones: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  preferences: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
