import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

import { BloodComponent } from '../../blood-units/enums/blood-component.enum';
import { BloodType } from '../../blood-units/enums/blood-type.enum';

/**
 * Default volume of a single blood unit (bag) in millilitres.
 * Used to convert millilitre stock into whole unit counts for threshold checks.
 */
export const ML_PER_BLOOD_UNIT = 450;

@Entity('inventory_stocks')
@Index(
  'idx_inventory_stocks_bank_blood_type_component_unique',
  ['bloodBankId', 'bloodType', 'component'],
  {
    unique: true,
  },
)
@Index('idx_inventory_stocks_bank', ['bloodBankId'])
@Index('idx_inventory_stocks_blood_type', ['bloodType'])
export class InventoryStockEntity {
  @PrimaryGeneratedColumn('.uuid')
  id: string;

  @Column({ name: 'blood_bank_id', type: 'varchar', length: 64 })
  bloodBankId: string;

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
    default: BloodComponent.WHOLE_BLOOD,
  })
  component: BloodComponent;

  @Column({ name: 'total_units_ml', type: 'int', default: 0 })
  totalUnitsMl: number;

  @Column({ name: 'available_units_ml', type: 'int', default: 0 })
  availableUnitsMl: number;

  @Column({ name: 'reserved_units_ml', type: 'int', default: 0 })
  reservedUnitsMl: number;

  @Column({ name: 'allocated_units_ml', type: 'int', default: 0 })
  allocatedUnitsMl: number;

  @VersionColumn()
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  /**
   * Backward compatibility: map old availableUnits to availableUnitsMl
   */
  get availableUnits(): number {
    return this.availableUnitsMl;
  }

  set availableUnits(value: number) {
    this.availableUnitsMl = value;
  }

  /**
   * Number of whole blood units (bags) currently available.
   * Converts the millilitre stock into unit counts so threshold checks
   * compare like with like.
   */
  getAvailableUnitCount(): number {
    return Math.floor(this.availableUnitsMl / ML_PER_BLOOD_UNIT);
  }

  /**
   * Get the quantity that can be reserved (available but not yet reserved)
   */
  getReservableQuantity(): number {
    return this.availableUnitsMl;
  }

  /**
   * Get the quantity that can be allocated (reserved or available)
   */
  getAllocatableQuantity(): number {
    return this.availableUnitsMl + this.reservedUnitsMl;
  }

  /**
   * Update available and reserved quantities (without allocation)
   */
  reserve(quantityMl: number): void {
    this.availableUnitsMl = Math.max(0, this.availableUnitsMl - quantityMl);
    this.reservedUnitsMl += quantityMl;
  }

  /**
   * Move reserved inventory to allocated
   */
  allocate(quantityMl: number): void {
    const toAllocate = Math.min(quantityMl, this.reservedUnitsMl);
    this.reservedUnitsMl = Math.max(0, this.reservedUnitsMl - toAllocate);
    this.allocatedUnitsMl += toAllocate;
  }

  /**
   * Release reserved inventory back to available
   */
  releaseReserved(quantityMl: number): void {
    const toRelease = Math.min(quantityMl, this.reservedUnitsMl);
    this.reservedUnitsMl = Math.max(0, this.reservedUnitsMl - toRelease);
    this.availableUnitsMl += toRelease;
  }

  /**
   * Release allocated inventory (consumed from supply)
   */
  releaseAllocated(quantityMl: number): void {
    const toRelease = Math.min(quantityMl, this.allocatedUnitsMl);
    this.allocatedUnitsMl = Math.max(0, this.allocatedUnitsMl - toRelease);
    this.totalUnitsMl = Math.max(0, this.totalUnitsMl - toRelease);
  }

  /**
   * Validate internal consistency
   */
  isConsistent(): boolean {
    const sumAllocated = this.availableUnitsMl + this.reservedUnitsMl + this.allocatedUnitsMl;
    return sumAllocated <= this.totalUnitsMl && this.availableUnitsMl >= 0 && this.reservedUnitsMl >= 0 && this.allocatedUnitsMl >= 0;
  }
}
