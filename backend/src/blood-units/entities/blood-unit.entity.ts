import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
  OneToMany,
  BaseEntity,
} from 'typeorm';

import { BloodComponent } from '../enums/blood-component.enum';
import { BloodStatus } from '../enums/blood-status.enum';
import { BloodType } from '../enums/blood-type.enum';

import { BloodStatusHistory } from './blood-status-history.entity';

@Entity('blood_units')
@Index(['unitNumber'], { unique: true })
@Index(['bloodType', 'bankId'])
export class BloodUnitEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 80, unique: true })
  unitNumber: string;

  @Column({ type: 'bigint', nullable: true })
  blockchainUnitId?: number;

  @Column({ type: 'varchar', length: 255 })
  blockchainTransactionHash: string;

  @Column({ type: 'varchar', length: 5 })
  bloodType: string;

  @Column({ type: 'int' })
  quantityMl: number;

  @Column({ type: 'varchar', length: 100, nullable: true })
  donorId?: string;

  @Column({ type: 'varchar', length: 70 })
  bankId: string;

  @Column({ type: 'timestamp' })
  expirationDate: Date;

  @Column({ type: 'varchar', length: 80, nullable: true })
  registeredBy?: string;

  @Column({ type: 'text' })
  barcodeData: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('blood_units')
@Index('idx_blood_units_blood_type', ['bloodType'])
@Index('idx_blood_units_status', ['status'])
@Index('idx_blood_units_organization', ['organizationId'])
@Index('idx_blood_units_expiry', ['expiresAt'])
export class BloodUnit extends BaseEntity {
  @Column({ name: 'unit_code', type: 'varchar', unique: true })
  unitCode: string;

  @Column({
    name: 'blood_type',
    type: 'enum',
    enum: BloodType,
  })
  bloodType: BloodType;

  @Column({
    type: 'enum',
    enum: BloodStatus,
    default: BloodStatus.AVAILABLE,
  })
  status: BloodStatus;

  @Column({
    type: 'enum',
    enum: BloodComponent,
  })
  component: BloodComponent;

  @Column({ name: 'organization_id', type: 'varchar' })
  organizationId: string;

  @Column({ name: 'volume_ml', type: 'int' })
  volumeMl: number;

  @Column({ name: 'collected_at', type: 'timestamp' })
  collectedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamp' })
  expiresAt: Date;

  @Column({ name: 'test_results', type: 'jsonb', nullable: true })
  testResults: Record<string, unknown> | null;

  @Column({
    name: 'storage_temperature_celsius',
    type: 'float',
    nullable: true,
  })
  storageTemperatureCelsius: number | null;

  @Column({ name: 'storage_location', type: 'varchar', nullable: true })
  storageLocation: string | null;

  @Column({ name: 'donor_id', type: 'varchar', nullable: true })
  donorId: string | null;

  @Column({ name: 'blockchain_unit_id', type: 'varchar', nullable: true })
  blockchainUnitId: string | null;

  @Column({ name: 'blockchain_tx_hash', type: 'varchar', nullable: true })
  blockchainTxHash: string | null;

  @Column({ name: 'reserved_for', type: 'varchar', nullable: true })
  reservedFor: string | null;

  @Column({ name: 'reserved_until', type: 'timestamp', nullable: true })
  reservedUntil: Date | null;

  @OneToMany(() => BloodStatusHistory, (history) => history.bloodUnit, {
    cascade: true,
  })
  statusHistory: BloodStatusHistory[];

  /**
   * Check if the blood unit has expired
   */
  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  /**
   * Check if the blood unit is available for use
   */
  isAvailable(): boolean {
    return this.status === BloodStatus.AVAILABLE && !this.isExpired();
  }

  /**
   * Check if the blood unit is reserved
   */
  isReserved(): boolean {
    return this.status === BloodStatus.RESERVED;
  }

  /**
   * Check if the blood unit is in transit
   */
  isInTransit(): boolean {
    return this.status === BloodStatus.IN_TRANSIT;
  }

  /**
   * Check if the blood unit is quarantined
   */
  isQuarantined(): boolean {
    return this.status === BloodStatus.QUARANTINED;
  }

  /**
   * Validate the blood unit data
   */
  validate(): BloodUnitValidationResult {
    const errors: string[] = [];

    // Validate volume
    if (this.volumeMl <= 0) {
      errors.push('Volume must be greater than 0');
    }

    // Validate expiration date
    if (this.expiresAt <= this.collectedAt) {
      errors.push('Expiration date must be after collection date');
    }

    // Check if expired
    if (this.isExpired()) {
      errors.push('Blood unit has expired');
    }

    // Validate blood type
    if (!Object.values(BloodType).includes(this.bloodType)) {
      errors.push('Invalid blood type');
    }

    // Validate component
    if (!Object.values(BloodComponent).includes(this.component)) {
      errors.push('Invalid blood component');
    }

    // Validate status
    if (!Object.values(BloodStatus).includes(this.status)) {
      errors.push('Invalid blood status');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get the remaining shelf life in hours
   */
  getRemainingShelfLifeHours(): number {
    const now = new Date();
    const diffMs = this.expiresAt.getTime() - now.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
  }

  /**
   * Get the remaining shelf life as a percentage
   */
  getRemainingShelfLifePercentage(): number {
    const totalShelfLifeMs =
      this.expiresAt.getTime() - this.collectedAt.getTime();
    const remainingMs = this.expiresAt.getTime() - new Date().getTime();
    return Math.max(0, Math.min(100, (remainingMs / totalShelfLifeMs) * 100));
  }

  /**
   * Check if the blood unit is compatible with a given blood type
   */
  isCompatibleWith(bloodType: BloodType): boolean {
    const compatibilityMap: Record<BloodType, BloodType[]> = {
      [BloodType.O_NEGATIVE]: [
        BloodType.O_NEGATIVE,
        BloodType.O_POSITIVE,
        BloodType.A_NEGATIVE,
        BloodType.A_POSITIVE,
        BloodType.B_NEGATIVE,
        BloodType.B_POSITIVE,
        BloodType.AB_NEGATIVE,
        BloodType.AB_POSITIVE,
      ],
      [BloodType.O_POSITIVE]: [
        BloodType.O_POSITIVE,
        BloodType.A_POSITIVE,
        BloodType.B_POSITIVE,
        BloodType.AB_POSITIVE,
      ],
      [BloodType.A_NEGATIVE]: [
        BloodType.A_NEGATIVE,
        BloodType.A_POSITIVE,
        BloodType.AB_NEGATIVE,
        BloodType.AB_POSITIVE,
      ],
      [BloodType.A_POSITIVE]: [BloodType.A_POSITIVE, BloodType.AB_POSITIVE],
      [BloodType.B_NEGATIVE]: [
        BloodType.B_NEGATIVE,
        BloodType.B_POSITIVE,
        BloodType.AB_NEGATIVE,
        BloodType.AB_POSITIVE,
      ],
      [BloodType.B_POSITIVE]: [BloodType.B_POSITIVE, BloodType.AB_POSITIVE],
      [BloodType.AB_NEGATIVE]: [BloodType.AB_NEGATIVE, BloodType.AB_POSITIVE],
      [BloodType.AB_POSITIVE]: [BloodType.AB_POSITIVE],
    };

    return compatibilityMap[this.bloodType]?.includes(bloodType) ?? false;
  }

  /**
   * Update the blood unit status
   */
  updateStatus(newStatus: BloodStatus): void {
    this.status = newStatus;
  }

  /**
   * Mark the blood unit as expired
   */
  markAsExpired(): void {
    this.status = BloodStatus.EXPIRED;
  }

  /**
   * Mark the blood unit as reserved
   */
  markAsReserved(): void {
    this.status = BloodStatus.RESERVED;
  }

  /**
   * Mark the blood unit as available
   */
  markAsAvailable(): void {
    if (!this.isExpired()) {
      this.status = BloodStatus.AVAILABLE;
    }
  }

  /**
   * Get a summary of the blood unit
   */
  getSummary(): Record<string, unknown> {
    return {
      id: this.id,
      unitCode: this.unitCode,
      bloodType: this.bloodType,
      component: this.component,
      volumeMl: this.volumeMl,
      status: this.status,
      expiresAt: this.expiresAt.toISOString(),
      isExpired: this.isExpired(),
      isAvailable: this.isAvailable(),
      remainingShelfLifeHours: this.getRemainingShelfLifeHours(),
      organizationId: this.organizationId,
    };
  }

  /**
   * Check equality with another blood unit
   */
  equals(other: BloodUnit): boolean {
    return this.id === other.id;
  }

  /**
   * Create a plain object representation
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      unitCode: this.unitCode,
      bloodType: this.bloodType,
      component: this.component,
      volumeMl: this.volumeMl,
      status: this.status,
      organizationId: this.organizationId,
      donorId: this.donorId,
      collectedAt: this.collectedAt.toISOString(),
      expiresAt: this.expiresAt.toISOString(),
      testResults: this.testResults,
      storageTemperatureCelsius: this.storageTemperatureCelsius,
      storageLocation: this.storageLocation,
      blockchainUnitId: this.blockchainUnitId,
      blockchainTxHash: this.blockchainTxHash,
      metadata: this.metadata,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
    };
  }
}
