import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BloodType, BloodComponent, BloodUnitStatus } from '../enums/blood-unit.enum';
import { Organization } from '../../organizations/entities/organization.entity';
import { Donor } from '../../donors/entities/donor.entity';

@Entity('blood_units')
@Index(['organizationId', 'status'])
@Index(['bloodType', 'component'])
@Index(['expiresAt'])
export class BloodUnitEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'unit_number', unique: true })
  unitNumber: string;

  @Column({ name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'donor_id', nullable: true })
  donorId: string | null;

  @ManyToOne(() => Donor, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'donor_id' })
  donor: Donor | null;

  @Column({
    type: 'enum',
    enum: BloodType,
    name: 'blood_type',
  })
  bloodType: BloodType;

  @Column({
    type: 'enum',
    enum: BloodComponent,
  })
  component: BloodComponent;

  @Column({
    type: 'enum',
    enum: BloodUnitStatus,
    default: BloodUnitStatus.AVAILABLE,
  })
  status: BloodUnitStatus;

  @Column({ name: 'quantity_ml', type: 'int' })
  quantityMl: number;

  @Column({ name: 'collected_at', type: 'timestamptz' })
  collectedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'blockchain_tx_hash', type: 'varchar', length: 128, nullable: true })
  blockchainTxHash: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
