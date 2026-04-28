import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface RouteCheckpoint {
  latitude: number;
  longitude: number;
  expectedArrivalAt: string; // ISO timestamp
  label?: string;
}

@Entity('planned_routes')
@Index('idx_planned_routes_order_id', ['orderId'])
@Index('idx_planned_routes_rider_id', ['riderId'])
@Index('idx_planned_routes_active', ['isActive'])
export class PlannedRouteEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'varchar', length: 64 })
  orderId: string;

  @Column({ name: 'rider_id', type: 'varchar', length: 64 })
  riderId: string;

  /** Encoded polyline of the planned corridor */
  @Column({ name: 'polyline', type: 'text' })
  polyline: string;

  /** ETA checkpoints along the route */
  @Column({ name: 'checkpoints', type: 'jsonb', default: '[]' })
  checkpoints: RouteCheckpoint[];

  /** Corridor half-width in metres — deviation beyond this triggers an alert */
  @Column({ name: 'corridor_radius_m', type: 'int', default: 300 })
  corridorRadiusM: number;

  /** Max seconds off-corridor before escalation */
  @Column({ name: 'max_deviation_seconds', type: 'int', default: 120 })
  maxDeviationSeconds: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
