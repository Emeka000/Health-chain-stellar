import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { BloodType } from '../../blood-units/enums/blood-type.enum';

@Entity('surge_rules')
@Index(['bloodType'], { unique: true })
export class SurgeRuleEntity extends BaseEntity {
  @Column({ name: 'blood_type', type: 'enum', enum: BloodType })
  bloodType: BloodType;

  /** Inventory level (availableUnitsMl) below which surge activates */
  @Column({ name: 'threshold', type: 'int' })
  threshold: number;

  /** Fee multiplier when surge is active, e.g. 1.5 */
  @Column({ name: 'multiplier', type: 'decimal', precision: 5, scale: 2 })
  multiplier: number;

  /** Hard cap on the multiplier */
  @Column({ name: 'max_multiplier', type: 'decimal', precision: 5, scale: 2, default: 3 })
  maxMultiplier: number;

  @Column({ name: 'active', type: 'boolean', default: false })
  active: boolean;
}
