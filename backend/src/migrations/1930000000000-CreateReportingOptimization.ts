import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

/**
 * Migration: Reporting Optimization
 *
 * 1. Adds composite indexes on high-cardinality reporting columns.
 * 2. Creates a `report_materialized_views` metadata table that tracks
 *    staleness of each pre-aggregated view.
 * 3. Creates four PostgreSQL MATERIALIZED VIEWs for the most expensive
 *    reporting aggregations (orders, blood units, disputes, blood requests).
 *
 * All views are created with NO DATA so the first REFRESH is explicit and
 * controlled (avoids blocking the migration on large datasets).
 */
export class CreateReportingOptimization1930000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Supplementary indexes for reporting filters ─────────────────────

    // Orders: composite index for date-range + status queries
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_ORDERS_CREATED_AT_STATUS"
        ON orders (created_at DESC, status)
    `);

    // Orders: composite index for hospital + date range (most common report filter)
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_ORDERS_HOSPITAL_CREATED"
        ON orders (hospital_id, created_at DESC)
    `);

    // Blood units: blood_type + status + created_at
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_BLOOD_UNITS_TYPE_STATUS_DATE"
        ON blood_units (blood_type, status, created_at DESC)
    `);

    // Blood requests: blood_type + status + created_at
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_BLOOD_REQUESTS_TYPE_STATUS_DATE"
        ON blood_requests (blood_type, status, created_at DESC)
    `);

    // Disputes: status + created_at
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_DISPUTES_STATUS_CREATED"
        ON disputes (status, created_at DESC)
    `);

    // Users (donors): role + created_at
    await queryRunner.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_USERS_ROLE_CREATED"
        ON users (role, created_at DESC)
    `);

    // ── 2. Materialized view staleness metadata table ──────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS report_view_metadata (
        view_name        VARCHAR(120) PRIMARY KEY,
        last_refreshed   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        refresh_duration_ms BIGINT   NOT NULL DEFAULT 0,
        row_count        BIGINT       NOT NULL DEFAULT 0,
        is_stale         BOOLEAN      NOT NULL DEFAULT TRUE,
        stale_after_seconds INT       NOT NULL DEFAULT 300,
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    // ── 3. Materialized views ──────────────────────────────────────────────

    // 3a. Daily order summary (status counts + fee totals per day)
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_order_summary AS
      SELECT
        DATE_TRUNC('day', created_at)::DATE  AS report_date,
        status,
        COUNT(*)                             AS order_count,
        SUM(quantity)                        AS total_quantity,
        SUM((fee_breakdown->>'totalFee')::NUMERIC)   AS total_fees,
        SUM((fee_breakdown->>'deliveryFee')::NUMERIC) AS total_delivery_fees,
        SUM((fee_breakdown->>'platformFee')::NUMERIC) AS total_platform_fees
      FROM orders
      GROUP BY DATE_TRUNC('day', created_at)::DATE, status
      WITH NO DATA
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_MV_DAILY_ORDER_SUMMARY"
        ON mv_daily_order_summary (report_date, status)
    `);

    // 3b. Blood unit inventory snapshot (type + status counts)
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_blood_unit_inventory AS
      SELECT
        blood_type,
        status,
        COUNT(*)          AS unit_count,
        SUM(volume_ml)    AS total_volume_ml,
        MIN(expires_at)   AS earliest_expiry,
        MAX(created_at)   AS latest_intake
      FROM blood_units
      GROUP BY blood_type, status
      WITH NO DATA
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_MV_BLOOD_UNIT_INVENTORY"
        ON mv_blood_unit_inventory (blood_type, status)
    `);

    // 3c. Daily dispute summary
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_dispute_summary AS
      SELECT
        DATE_TRUNC('day', created_at)::DATE AS report_date,
        status,
        COUNT(*)                            AS dispute_count
      FROM disputes
      GROUP BY DATE_TRUNC('day', created_at)::DATE, status
      WITH NO DATA
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_MV_DAILY_DISPUTE_SUMMARY"
        ON mv_daily_dispute_summary (report_date, status)
    `);

    // 3d. Blood request summary by blood type + status
    await queryRunner.query(`
      CREATE MATERIALIZED VIEW IF NOT EXISTS mv_blood_request_summary AS
      SELECT
        blood_type,
        status,
        COUNT(*)       AS request_count,
        SUM(quantity)  AS total_quantity_requested
      FROM blood_requests
      GROUP BY blood_type, status
      WITH NO DATA
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_MV_BLOOD_REQUEST_SUMMARY"
        ON mv_blood_request_summary (blood_type, status)
    `);

    // ── 4. Seed metadata rows ──────────────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO report_view_metadata (view_name, stale_after_seconds) VALUES
        ('mv_daily_order_summary',    300),
        ('mv_blood_unit_inventory',   120),
        ('mv_daily_dispute_summary',  300),
        ('mv_blood_request_summary',  120)
      ON CONFLICT (view_name) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS mv_blood_request_summary`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS mv_daily_dispute_summary`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS mv_blood_unit_inventory`);
    await queryRunner.query(`DROP MATERIALIZED VIEW IF EXISTS mv_daily_order_summary`);
    await queryRunner.query(`DROP TABLE IF EXISTS report_view_metadata`);

    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_USERS_ROLE_CREATED"`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_DISPUTES_STATUS_CREATED"`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_BLOOD_REQUESTS_TYPE_STATUS_DATE"`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_BLOOD_UNITS_TYPE_STATUS_DATE"`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_ORDERS_HOSPITAL_CREATED"`);
    await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "IDX_ORDERS_CREATED_AT_STATUS"`);
  }
}
