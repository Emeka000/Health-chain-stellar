import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

@Entity('delivery_compliance')
@Index(['deliveryId'], { unique: true })
export class DeliveryComplianceEntity extends BaseEntity {
  @Column({ name: 'delivery_id', unique: true })
  deliveryId: string;

  @Column({ name: 'order_id', nullable: true, type: 'varchar' })
  orderId: string | null;

  @Column({ name: 'is_compliant', default: true })
  isCompliant: boolean;

  @Column({ name: 'excursion_count', default: 0 })
  excursionCount: number;

  @Column({ name: 'min_temp_celsius', type: 'float', nullable: true })
  minTempCelsius: number | null;

  @Column({ name: 'max_temp_celsius', type: 'float', nullable: true })
  maxTempCelsius: number | null;

  @Column({ name: 'compliance_hash', type: 'varchar', nullable: true })
  complianceHash: string | null;

  @Column({ name: 'evaluated_at', type: 'timestamptz', nullable: true })
  evaluatedAt: Date | null;

  /** Cumulative minutes the delivery has spent outside 2–8 °C. */
  @Column({ name: 'breach_duration_minutes', type: 'float', default: 0 })
  breachDurationMinutes: number;

  /** Timestamp of the first excursion sample in the current breach window. */
  @Column({ name: 'breach_started_at', type: 'timestamptz', nullable: true })
  breachStartedAt: Date | null;

  /** Whether a suspension event has already been fired for this delivery. */
  @Column({ name: 'suspension_triggered', default: false })
  suspensionTriggered: boolean;
}
