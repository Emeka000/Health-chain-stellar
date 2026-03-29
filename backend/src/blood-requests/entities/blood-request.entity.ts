import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';

import { BloodComponent } from '../../blood-units/enums/blood-component.enum';
import { BloodType } from '../../blood-units/enums/blood-type.enum';
import { BloodRequestStatus } from '../enums/blood-request-status.enum';
import { EscalationTier } from '../../escalation/enums/escalation-tier.enum';

import { BloodRequestItemEntity } from './blood-request-item.entity';
import { BloodRequestReservationEntity } from './blood-request-reservation.entity';

export enum RequestUrgency {
  CRITICAL = 'CRITICAL', // < 2 hours
  URGENT = 'URGENT', // 2-6 hours
  ROUTINE = 'ROUTINE', // 6-24 hours
  SCHEDULED = 'SCHEDULED', // > 24 hours
}

// Backward compatibility export
export const Urgency = RequestUrgency;

export interface BloodRequestValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface FulfillmentProgress {
  totalRequestedMl: number;
  totalFulfilledMl: number;
  totalRemainingMl: number;
  percentage: number;
  itemsCount: number;
  itemsFulfilledCount: number;
}

@Entity('blood_requests')
@Index('idx_blood_requests_hospital', ['hospitalId'])
@Index('idx_blood_requests_status', ['status'])
@Index('idx_blood_requests_urgency', ['urgency'])
@Index('idx_blood_requests_required_by', ['requiredByTimestamp'])
export class BloodRequestEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_number', type: 'varchar', length: 64, unique: true })
  requestNumber: string;

  @Column({ name: 'hospital_id', type: 'varchar', length: 64 })
  hospitalId: string;

  @Column({
    type: 'enum',
    enum: RequestUrgency,
    default: RequestUrgency.ROUTINE,
  })
  urgency: RequestUrgency;

  @Column({ name: 'created_timestamp', type: 'bigint' })
  createdTimestamp: number;

  @Column({ name: 'required_by_timestamp', type: 'bigint' })
  requiredByTimestamp: number;

  @Column({
    type: 'varchar',
    length: 24,
    default: BloodRequestStatus.PENDING,
  })
  status: BloodRequestStatus;

  @Column({ name: 'delivery_address', type: 'text', nullable: true })
  deliveryAddress: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({
    name: 'blockchain_tx_hash',
    type: 'varchar',
    length: 256,
    nullable: true,
  })
  blockchainTxHash: string | null;

  @Column({
    name: 'created_by_user_id',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  createdByUserId: string | null;

  @Column({
    name: 'escalation_tier',
    type: 'varchar',
    length: 16,
    default: EscalationTier.NONE,
  })
  escalationTier: EscalationTier;

  @OneToMany(() => BloodRequestItemEntity, (item) => item.request, {
    cascade: true,
    eager: true,
  })
  items: BloodRequestItemEntity[];

  @OneToMany(() => BloodRequestReservationEntity, (res) => res.request, {
    cascade: true,
  })
  reservations: BloodRequestReservationEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /**
   * Get total requested quantity across all items
   */
  getTotalRequestedMl(): number {
    return this.items?.reduce((sum, item) => sum + item.quantityMl, 0) ?? 0;
  }

  /**
   * Get total fulfilled quantity across all items
   */
  getTotalFulfilledMl(): number {
    return this.items?.reduce((sum, item) => sum + item.fulfilledQuantityMl, 0) ?? 0;
  }

  /**
   * Get total remaining to fulfill
   */
  getTotalRemainingMl(): number {
    return this.getTotalRequestedMl() - this.getTotalFulfilledMl();
  }

  /**
   * Check if the request is completely fulfilled
   */
  isFulfilled(): boolean {
    if (!this.items || this.items.length === 0) return false;
    return this.items.every((item) => item.isFulfilled());
  }

  /**
   * Get fulfillment progress across all items
   */
  getProgress(): FulfillmentProgress {
    const totalRequestedMl = this.getTotalRequestedMl();
    const totalFulfilledMl = this.getTotalFulfilledMl();
    const percentage = totalRequestedMl > 0 ? (totalFulfilledMl / totalRequestedMl) * 100 : 0;
    const itemsFulfilledCount = this.items?.filter((i) => i.isFulfilled()).length ?? 0;

    return {
      totalRequestedMl,
      totalFulfilledMl,
      totalRemainingMl: totalRequestedMl - totalFulfilledMl,
      percentage,
      itemsCount: this.items?.length ?? 0,
      itemsFulfilledCount,
    };
  }

  /**
   * Get the time remaining until required by timestamp (in seconds)
   */
  timeRemaining(currentTimestamp: number): number {
    if (this.requiredByTimestamp > currentTimestamp) {
      return this.requiredByTimestamp - currentTimestamp;
    }
    return 0;
  }

  /**
   * Check if the request is overdue
   */
  isOverdue(currentTimestamp: number): boolean {
    return this.requiredByTimestamp < currentTimestamp && !this.isFulfilled();
  }

  /**
   * Get the urgency level based on time remaining
   */
  getUrgencyLevel(currentTimestamp: number): RequestUrgency {
    const timeRemainingHours = this.timeRemaining(currentTimestamp) / 3600;

    if (timeRemainingHours < 2) {
      return RequestUrgency.CRITICAL;
    } else if (timeRemainingHours < 6) {
      return RequestUrgency.URGENT;
    } else if (timeRemainingHours < 24) {
      return RequestUrgency.ROUTINE;
    } else {
      return RequestUrgency.SCHEDULED;
    }
  }

  /**
   * Validate the blood request data
   */
  validate(): BloodRequestValidationResult {
    const errors: string[] = [];

    if (!this.items || this.items.length === 0) {
      errors.push('Request must have at least one item');
    }

    // Validate required by timestamp
    if (this.requiredByTimestamp <= this.createdTimestamp) {
      errors.push('Required by timestamp must be after creation timestamp');
    }

    // Validate urgency
    if (!Object.values(RequestUrgency).includes(this.urgency)) {
      errors.push('Invalid urgency level');
    }

    // Validate status
    if (!Object.values(BloodRequestStatus).includes(this.status)) {
      errors.push('Invalid request status');
    }

    // Validate items if present
    for (let i = 0; i < (this.items?.length || 0); i++) {
      const item = this.items![i];
      if (!item.quantityMl || item.quantityMl <= 0) {
        errors.push(`Item ${i + 1}: Quantity must be greater than 0`);
      }
      if (item.fulfilledQuantityMl > item.quantityMl) {
        errors.push(`Item ${i + 1}: Fulfilled quantity cannot exceed requested quantity`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Update the request status
   */
  updateStatus(newStatus: BloodRequestStatus): void {
    this.status = newStatus;
  }

  /**
   * Mark the request as fulfilled
   */
  markAsFulfilled(): void {
    this.status = BloodRequestStatus.FULFILLED;
  }

  /**
   * Mark the request as cancelled
   */
  markAsCancelled(): void {
    this.status = BloodRequestStatus.CANCELLED;
  }

  /**
   * Check equality with another blood request
   */
  equals(other: BloodRequestEntity): boolean {
    return this.id === other.id;
  }
}
