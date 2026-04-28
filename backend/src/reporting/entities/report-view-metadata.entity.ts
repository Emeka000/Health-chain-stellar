import { Entity, Column, PrimaryColumn, UpdateDateColumn, CreateDateColumn } from 'typeorm';

/**
 * Tracks staleness metadata for each pre-aggregated materialized view.
 * Consumers can query this table to determine data freshness before
 * deciding whether to use the fast materialized path or fall back to
 * the live query path.
 */
@Entity('report_view_metadata')
export class ReportViewMetadataEntity {
  /** Matches the PostgreSQL materialized view name exactly. */
  @PrimaryColumn({ name: 'view_name', type: 'varchar', length: 120 })
  viewName: string;

  /** Timestamp of the last successful REFRESH MATERIALIZED VIEW. */
  @Column({ name: 'last_refreshed', type: 'timestamptz' })
  lastRefreshed: Date;

  /** How long the last refresh took in milliseconds. */
  @Column({ name: 'refresh_duration_ms', type: 'bigint', default: 0 })
  refreshDurationMs: number;

  /** Approximate row count after the last refresh. */
  @Column({ name: 'row_count', type: 'bigint', default: 0 })
  rowCount: number;

  /**
   * Whether the view is considered stale.
   * Set to TRUE immediately after a write to the underlying tables
   * (managed by the ReportViewRefreshService) and FALSE after a refresh.
   */
  @Column({ name: 'is_stale', type: 'boolean', default: true })
  isStale: boolean;

  /**
   * Number of seconds after which the view is automatically considered stale
   * even if no explicit invalidation occurred.
   */
  @Column({ name: 'stale_after_seconds', type: 'int', default: 300 })
  staleAfterSeconds: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
