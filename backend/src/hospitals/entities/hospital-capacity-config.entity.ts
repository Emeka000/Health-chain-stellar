import { Column, Entity, Index, JoinColumn, OneToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';
import { HospitalEntity } from './hospital.entity';

/**
 * Receiving window slot: e.g. { dayOfWeek: 1, openTime: '08:00', closeTime: '18:00' }
 * dayOfWeek: 0 = Sunday … 6 = Saturday (ISO-like, but JS Date convention)
 */
export interface ReceivingWindowSlot {
  dayOfWeek: number; // 0–6
  openTime: string; // 'HH:mm' UTC
  closeTime: string; // 'HH:mm' UTC
}

/**
 * Blackout period: hospital cannot receive during this window regardless of schedule.
 * e.g. public holidays, planned maintenance.
 */
export interface BlackoutPeriod {
  label: string;
  startIso: string; // ISO 8601 datetime
  endIso: string; // ISO 8601 datetime
}

@Entity('hospital_capacity_configs')
@Index('idx_hospital_capacity_hospital_id', ['hospitalId'], { unique: true })
export class HospitalCapacityConfigEntity extends BaseEntity {
  @Column({ name: 'hospital_id', type: 'uuid', unique: true })
  hospitalId: string;

  @OneToOne(() => HospitalEntity, (h) => h.capacityConfig, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'hospital_id' })
  hospital: HospitalEntity;

  /** Maximum blood units the cold-storage facility can hold at one time */
  @Column({ name: 'cold_storage_capacity_units', type: 'int', default: 0 })
  coldStorageCapacityUnits: number;

  /** Units currently reserved/stored (updated on each intake confirmation) */
  @Column({ name: 'current_storage_units', type: 'int', default: 0 })
  currentStorageUnits: number;

  /** Weekly receiving schedule — null means 24/7 open */
  @Column({ name: 'receiving_windows', type: 'jsonb', nullable: true })
  receivingWindows: ReceivingWindowSlot[] | null;

  /** One-off blackout periods (planned closures, holidays, etc.) */
  @Column({ name: 'blackout_periods', type: 'jsonb', nullable: true })
  blackoutPeriods: BlackoutPeriod[] | null;

  /** When true, emergency overrides are permitted without pre-approval */
  @Column({ name: 'allow_emergency_override', type: 'boolean', default: true })
  allowEmergencyOverride: boolean;

  /** Max lead-time buffer in minutes added to projected delivery window */
  @Column({ name: 'intake_buffer_minutes', type: 'int', default: 30 })
  intakeBufferMinutes: number;

  /** Whether this config is actively enforced during matching */
  @Column({ name: 'is_enforced', type: 'boolean', default: true })
  isEnforced: boolean;
}
