import { Column, Entity, Index, OneToOne } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';

import { HospitalStatus } from '../enums/hospital-status.enum';
import { HospitalCapacityConfigEntity } from './hospital-capacity-config.entity';

@Entity('hospitals')
@Index('idx_hospitals_status', ['status'])
@Index('idx_hospitals_region_code', ['regionCode'])
export class HospitalEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'varchar', length: 500 })
  address: string;

  @Column({ type: 'varchar', length: 20, nullable: true, name: 'region_code' })
  regionCode: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: number | null;

  @Column({ type: 'varchar', length: 40, nullable: true, name: 'phone_number' })
  phoneNumber: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  email: string | null;

  @Column({
    type: 'enum',
    enum: HospitalStatus,
    default: HospitalStatus.ACTIVE,
  })
  status: HospitalStatus;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @OneToOne(() => HospitalCapacityConfigEntity, (config) => config.hospital, {
    cascade: true,
    nullable: true,
    eager: false,
  })
  capacityConfig?: HospitalCapacityConfigEntity | null;
}
