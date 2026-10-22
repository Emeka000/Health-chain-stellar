import { Entity, Column, Index, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ScenarioStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Stored scenario definition for deterministic replay.
 * Contains random seed and all resource constraint overrides.
 */
@Entity('surge_scenarios')
@Index(['status'])
export class SurgeScenarioEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar' })
  name: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  /** Random seed for deterministic replay */
  @Column({ name: 'seed', type: 'bigint' })
  seed: number;

  /** Surge demand in blood units */
  @Column({ name: 'surge_demand_units', type: 'int' })
  surgeDemandUnits: number;

  /** Override stock units (null = use live DB) */
  @Column({ name: 'override_stock_units', type: 'int', nullable: true })
  overrideStockUnits: number | null;

  /** Override rider capacity units (null = derive from active riders) */
  @Column({ name: 'override_rider_capacity_units', type: 'int', nullable: true })
  overrideRiderCapacityUnits: number | null;

  /** Units per rider assumption */
  @Column({ name: 'units_per_rider', type: 'decimal', precision: 5, scale: 2, default: 4 })
  unitsPerRider: number;

  /** Policy toggles: triage strategy, allocation strategy */
  @Column({ name: 'policy_config', type: 'jsonb', default: '{}' })
  policyConfig: Record<string, unknown>;

  /** Computed outcome metrics (populated after run) */
  @Column({ name: 'outcome', type: 'jsonb', nullable: true })
  outcome: Record<string, unknown> | null;

  @Column({ name: 'status', type: 'enum', enum: ScenarioStatus, default: ScenarioStatus.PENDING })
  status: ScenarioStatus;

  @Column({ name: 'created_by', type: 'varchar', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
