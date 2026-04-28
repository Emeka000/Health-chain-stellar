import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum DeviationStatus {
  OPEN = 'open',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
}

export enum DeviationSeverity {
  MINOR = 'minor',
  MODERATE = 'moderate',
  SEVERE = 'severe',
}

@Entity('route_deviation_incidents')
@Index('idx_deviation_order_id', ['orderId'])
@Index('idx_deviation_rider_id', ['riderId'])
@Index('idx_deviation_status', ['status'])
@Index('idx_deviation_created_at', ['createdAt'])
export class RouteDeviationIncidentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'varchar', length: 64 })
  orderId: string;

  @Column({ name: 'rider_id', type: 'varchar', length: 64 })
  riderId: string;

  @Column({ name: 'planned_route_id', type: 'uuid' })
  plannedRouteId: string;

  @Column({
    name: 'severity',
    type: 'enum',
    enum: DeviationSeverity,
    default: DeviationSeverity.MINOR,
  })
  severity: DeviationSeverity;

  @Column({
    name: 'status',
    type: 'enum',
    enum: DeviationStatus,
    default: DeviationStatus.OPEN,
  })
  status: DeviationStatus;

  /** Distance in metres from the planned corridor at detection time */
  @Column({ name: 'deviation_distance_m', type: 'float' })
  deviationDistanceM: number;

  /** Seconds the rider has been off-corridor */
  @Column({ name: 'deviation_duration_s', type: 'int', default: 0 })
  deviationDurationS: number;

  @Column({
    name: 'last_known_latitude',
    type: 'decimal',
    precision: 10,
    scale: 7,
  })
  lastKnownLatitude: number;

  @Column({
    name: 'last_known_longitude',
    type: 'decimal',
    precision: 10,
    scale: 7,
  })
  lastKnownLongitude: number;

  @Column({ name: 'reason', type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'recommended_action', type: 'text', nullable: true })
  recommendedAction: string | null;

  @Column({
    name: 'acknowledged_by',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  acknowledgedBy: string | null;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  /** Whether this incident has been fed into reputation scoring */
  @Column({ name: 'scoring_applied', type: 'boolean', default: false })
  scoringApplied: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
