import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('canary_metrics')
@Index(['rolloutId'])
@Index(['recordedAt'])
export class CanaryMetricEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'rollout_id' })
  rolloutId: string;

  @Column({ name: 'policy_version_id' })
  policyVersionId: string;

  /** Total requests processed under this policy version in the window */
  @Column({ name: 'total_requests', type: 'int', default: 0 })
  totalRequests: number;

  /** Requests that resulted in an error */
  @Column({ name: 'error_count', type: 'int', default: 0 })
  errorCount: number;

  /** Computed error rate (errorCount / totalRequests) */
  @Column({ name: 'error_rate', type: 'float', default: 0 })
  errorRate: number;

  /** Average latency in ms */
  @Column({ name: 'avg_latency_ms', type: 'float', nullable: true })
  avgLatencyMs: number | null;

  /** p99 latency in ms */
  @Column({ name: 'p99_latency_ms', type: 'float', nullable: true })
  p99LatencyMs: number | null;

  /** Arbitrary extra metrics (notification delivery rates, etc.) */
  @Column({ type: 'jsonb', nullable: true })
  extra: Record<string, any> | null;

  @Column({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
