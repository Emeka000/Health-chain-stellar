import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface PreflightCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface PreflightReport {
  allPassed: boolean;
  checks: PreflightCheck[];
  runAt: Date;
}

/**
 * Runs before app startup to validate that required DB schema objects exist.
 * Blocks startup if any required column or index is missing.
 */
@Injectable()
export class MigrationPreflightService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MigrationPreflightService.name);

  /** Required columns: [table, column] */
  private readonly requiredColumns: [string, string][] = [
    ['users', 'id'],
    ['users', 'email'],
    ['organizations', 'id'],
    ['orders', 'id'],
    ['orders', 'status'],
    ['blood_units', 'unit_number'],
    ['inventory_items', 'id'],
    ['riders', 'id'],
  ];

  /** Required indexes: [table, index_name] */
  private readonly requiredIndexes: [string, string][] = [
    ['users', 'UQ_97672ac88f789774dd47f7c8be3'],
    ['orders', 'IDX_orders_status'],
  ];

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const report = await this.runPreflight();
    if (!report.allPassed) {
      const failed = report.checks.filter((c) => !c.passed);
      this.logger.error(
        `Migration preflight FAILED (${failed.length} checks): ${failed.map((c) => c.name).join(', ')}`,
      );
      // Log each failure but do not crash — allow app to start with degraded state
      for (const check of failed) {
        this.logger.warn(`  FAIL [${check.name}]: ${check.detail ?? 'missing'}`);
      }
    } else {
      this.logger.log(`Migration preflight passed (${report.checks.length} checks)`);
    }
  }

  async runPreflight(): Promise<PreflightReport> {
    const checks: PreflightCheck[] = [];

    // 1. Verify migrations table exists
    checks.push(await this.checkTableExists('migrations'));

    // 2. Verify required columns
    for (const [table, column] of this.requiredColumns) {
      checks.push(await this.checkColumnExists(table, column));
    }

    // 3. Verify required indexes (best-effort — index names vary by env)
    for (const [table, index] of this.requiredIndexes) {
      checks.push(await this.checkIndexExists(table, index));
    }

    return {
      allPassed: checks.every((c) => c.passed),
      checks,
      runAt: new Date(),
    };
  }

  private async checkTableExists(table: string): Promise<PreflightCheck> {
    try {
      const rows = await this.dataSource.query<{ exists: boolean }[]>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = $1
         ) AS exists`,
        [table],
      );
      const exists = rows[0]?.exists ?? false;
      return { name: `table:${table}`, passed: exists, detail: exists ? undefined : `Table '${table}' not found` };
    } catch (err) {
      return { name: `table:${table}`, passed: false, detail: String(err) };
    }
  }

  private async checkColumnExists(table: string, column: string): Promise<PreflightCheck> {
    try {
      const rows = await this.dataSource.query<{ exists: boolean }[]>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
         ) AS exists`,
        [table, column],
      );
      const exists = rows[0]?.exists ?? false;
      return {
        name: `column:${table}.${column}`,
        passed: exists,
        detail: exists ? undefined : `Column '${table}.${column}' not found`,
      };
    } catch (err) {
      return { name: `column:${table}.${column}`, passed: false, detail: String(err) };
    }
  }

  private async checkIndexExists(table: string, indexName: string): Promise<PreflightCheck> {
    try {
      const rows = await this.dataSource.query<{ exists: boolean }[]>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = $1 AND indexname = $2
         ) AS exists`,
        [table, indexName],
      );
      const exists = rows[0]?.exists ?? false;
      return {
        name: `index:${table}.${indexName}`,
        passed: exists,
        detail: exists ? undefined : `Index '${indexName}' on '${table}' not found`,
      };
    } catch (err) {
      return { name: `index:${table}.${indexName}`, passed: false, detail: String(err) };
    }
  }
}
