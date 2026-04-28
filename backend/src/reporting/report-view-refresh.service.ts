import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ReportViewMetadataEntity } from './entities/report-view-metadata.entity';

export const MATERIALIZED_VIEWS = [
  'mv_daily_order_summary',
  'mv_blood_unit_inventory',
  'mv_daily_dispute_summary',
  'mv_blood_request_summary',
] as const;

export type MaterializedViewName = (typeof MATERIALIZED_VIEWS)[number];

export interface ViewFreshnessInfo {
  viewName: string;
  lastRefreshed: Date;
  isStale: boolean;
  ageSeconds: number;
  staleAfterSeconds: number;
}

/**
 * Manages incremental refresh and staleness tracking for pre-aggregated
 * materialized views used by the reporting module.
 *
 * Refresh strategy:
 *  - CONCURRENTLY when a unique index exists (no read lock on the view).
 *  - Falls back to a blocking refresh if CONCURRENTLY fails (e.g., first run
 *    when the view has no data yet).
 */
@Injectable()
export class ReportViewRefreshService {
  private readonly logger = new Logger(ReportViewRefreshService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(ReportViewMetadataEntity)
    private readonly metadataRepo: Repository<ReportViewMetadataEntity>,
  ) {}

  /**
   * Refresh a single materialized view and update its staleness metadata.
   * Returns the updated metadata record.
   */
  async refreshView(viewName: MaterializedViewName): Promise<ReportViewMetadataEntity> {
    this.logger.log(`Refreshing materialized view: ${viewName}`);
    const start = Date.now();

    try {
      // Attempt concurrent refresh (non-blocking for readers)
      await this.dataSource.query(
        `REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`,
      );
    } catch (err) {
      // CONCURRENTLY requires at least one row; fall back on empty view
      this.logger.warn(
        `CONCURRENTLY refresh failed for ${viewName}, falling back: ${(err as Error).message}`,
      );
      await this.dataSource.query(`REFRESH MATERIALIZED VIEW ${viewName}`);
    }

    const durationMs = Date.now() - start;

    // Count rows for metadata
    const [{ count }] = await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM ${viewName}`,
    );

    const meta = await this.metadataRepo.findOne({ where: { viewName } });
    const record = meta ?? this.metadataRepo.create({ viewName });
    record.lastRefreshed = new Date();
    record.refreshDurationMs = durationMs;
    record.rowCount = Number(count);
    record.isStale = false;

    const saved = await this.metadataRepo.save(record);
    this.logger.log(
      `View ${viewName} refreshed in ${durationMs}ms, ${count} rows`,
    );
    return saved;
  }

  /**
   * Refresh all registered materialized views sequentially.
   */
  async refreshAll(): Promise<ReportViewMetadataEntity[]> {
    const results: ReportViewMetadataEntity[] = [];
    for (const view of MATERIALIZED_VIEWS) {
      results.push(await this.refreshView(view));
    }
    return results;
  }

  /**
   * Mark a view as stale (called after writes to underlying tables).
   * Does not trigger a refresh — the next scheduled job or explicit call will.
   */
  async markStale(viewName: MaterializedViewName): Promise<void> {
    await this.metadataRepo.update({ viewName }, { isStale: true });
  }

  /**
   * Returns freshness info for all views, including computed age.
   */
  async getFreshnessInfo(): Promise<ViewFreshnessInfo[]> {
    const records = await this.metadataRepo.find();
    const now = Date.now();
    return records.map((r) => {
      const ageSeconds = Math.floor((now - r.lastRefreshed.getTime()) / 1000);
      return {
        viewName: r.viewName,
        lastRefreshed: r.lastRefreshed,
        isStale: r.isStale || ageSeconds > r.staleAfterSeconds,
        ageSeconds,
        staleAfterSeconds: r.staleAfterSeconds,
      };
    });
  }

  /**
   * Returns true if the view is fresh enough to serve from cache.
   */
  async isViewFresh(viewName: MaterializedViewName): Promise<boolean> {
    const meta = await this.metadataRepo.findOne({ where: { viewName } });
    if (!meta) return false;
    if (meta.isStale) return false;
    const ageSeconds = Math.floor((Date.now() - meta.lastRefreshed.getTime()) / 1000);
    return ageSeconds <= meta.staleAfterSeconds;
  }
}
