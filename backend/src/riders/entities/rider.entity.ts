import { Entity, Column, OneToOne, JoinColumn } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { RiderStatus } from '../enums/rider-status.enum';
import { VehicleType } from '../enums/vehicle-type.enum';

@Entity('riders')
export class RiderEntity extends BaseEntity {
  @OneToOne(() => UserEntity)
  @JoinColumn({ name: 'user_id' })
  user: UserEntity;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({
    name: 'vehicle_type',
    type: 'enum',
    enum: VehicleType,
    default: VehicleType.MOTORCYCLE,
  })
  vehicleType: VehicleType;

  @Column({ name: 'vehicle_number' })
  vehicleNumber: string;

  @Column({ name: 'license_number' })
  licenseNumber: string;

  @Column({
    type: 'enum',
    enum: RiderStatus,
    default: RiderStatus.OFFLINE,
  })
  status: RiderStatus;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: number;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: number;

  @Column({ name: 'identity_document_url', nullable: true })
  identityDocumentUrl: string;

  @Column({ name: 'vehicle_document_url', nullable: true })
  vehicleDocumentUrl: string;

  @Column({ name: 'is_verified', default: false })
  isVerified: boolean;

  @Column({ name: 'completed_deliveries', default: 0 })
  completedDeliveries: number;

  @Column({ name: 'cancelled_deliveries', default: 0 })
  cancelledDeliveries: number;

  @Column({ name: 'failed_deliveries', default: 0 })
  failedDeliveries: number;

  @Column({ type: 'float', default: 0 })
  rating: number;
}
