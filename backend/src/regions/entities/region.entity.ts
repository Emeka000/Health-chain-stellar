import { Column, Entity, Index } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';

@Entity('regions')
@Index('idx_regions_code', ['code'], { unique: true })
@Index('idx_regions_is_active', ['isActive'])
export class RegionEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 20, unique: true })
  code: string; // e.g. 'LAG', 'ABJ', 'PHC'

  @Column({ type: 'varchar', length: 100 })
  name: string; // e.g. 'Lagos', 'Abuja', 'Port Harcourt'

  @Column({
    type: 'varchar',
    length: 100,
    nullable: true,
    name: 'country_code',
  })
  countryCode: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  latitude: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  longitude: number | null;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 2,
    nullable: true,
    name: 'radius_km',
  })
  radiusKm: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}
