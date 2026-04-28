import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { BloodComponent } from '../../blood-units/enums/blood-component.enum';
import { BloodType } from '../../blood-units/enums/blood-type.enum';
import { BloodRequestEntity } from './blood-request.entity';

export enum ItemPriority {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  LOW = 'LOW',
}

export enum ItemFulfillmentStatus {
  UNFULFILLED = 'UNFULFILLED',
  PARTIALLY_FULFILLED = 'PARTIALLY_FULFILLED',
  FULFILLED = 'FULFILLED',
  CANCELLED = 'CANCELLED',
}

@Entity('blood_request_items')
@Index('idx_request_items_request', ['requestId'])
@Index('idx_request_items_fulfillment', ['fulfillmentStatus'])
export class BloodRequestItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @ManyToOne(() => BloodRequestEntity, (request) => request.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'request_id' })
  request: BloodRequestEntity;

  @Column({
    name: 'blood_type',
    type: 'enum',
    enum: BloodType,
  })
  bloodType: BloodType;

  @Column({
    name: 'component',
    type: 'enum',
    enum: BloodComponent,
  })
  component: BloodComponent;

  @Column({ name: 'quantity_ml', type: 'int' })
  quantityMl: number;

  @Column({ name: 'fulfilled_quantity_ml', type: 'int', default: 0 })
  fulfilledQuantityMl: number;

  @Column({
    name: 'priority',
    type: 'enum',
    enum: ItemPriority,
    default: ItemPriority.NORMAL,
  })
  priority: ItemPriority;

  @Column({
    name: 'fulfillment_status',
    type: 'enum',
    enum: ItemFulfillmentStatus,
    default: ItemFulfillmentStatus.UNFULFILLED,
  })
  fulfillmentStatus: ItemFulfillmentStatus;

  @Column({ name: 'compatibility_notes', type: 'text', nullable: true })
  compatibilityNotes?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /**
   * Check if this item is fulfilled
   */
  isFulfilled(): boolean {
    return this.fulfilledQuantityMl >= this.quantityMl;
  }

  /**
   * Update fulfillment status based on quantities
   */
  updateFulfillmentStatus(): void {
    if (this.fulfilledQuantityMl <= 0) {
      this.fulfillmentStatus = ItemFulfillmentStatus.UNFULFILLED;
    } else if (this.fulfilledQuantityMl >= this.quantityMl) {
      this.fulfillmentStatus = ItemFulfillmentStatus.FULFILLED;
    } else {
      this.fulfillmentStatus = ItemFulfillmentStatus.PARTIALLY_FULFILLED;
    }
  }

  /**
   * Get amount remaining to fulfill
   */
  getRemaining(): number {
    return Math.max(0, this.quantityMl - this.fulfilledQuantityMl);
  }
}
