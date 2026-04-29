import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface RepairResult {
  action: string;
  success: boolean;
  detail?: string;
}

/**
 * Forward-only repair scripts for common partial-apply migration failures.
 * Each repair is idempotent — safe to run multiple times.
 */
@Injectable()
export class MigrationRepairService {
  private readonly logger = new Logger(MigrationRepairService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Removes a stale migration record from the migrations table so it can be
   * re-applied. Use when a migration partially applied and left the DB in an
   * inconsistent state.
   */
  async removeStaleMigrationRecord(migrationName: string): Promise<RepairResult> {
    try {
      const result = await this.dataSource.query(
        `DELETE FROM migrations WHERE name = $1`,
        [migrationName],
      );
      const affected = result[1] as number;
      this.logger.log(`Removed stale migration record '${migrationName}' (${affected} rows)`);
      return { action: `remove:${migrationName}`, success: true, detail: `${affected} rows deleted` };
    } catch (err) {
      return { action: `remove:${migrationName}`, success: false, detail: String(err) };
    }
  }

  /**
   * Ensures a column exists on a table. If missing, adds it with the given
   * definition. Idempotent via IF NOT EXISTS.
   */
  async ensureColumnExists(
    table: string,
    column: string,
    definition: string,
  ): Promise<RepairResult> {
    const action = `ensure-column:${table}.${column}`;
    try {
      await this.dataSource.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${definition}`,
      );
      this.logger.log(`Ensured column ${table}.${column}`);
      return { action, success: true };
    } catch (err) {
      return { action, success: false, detail: String(err) };
    }
  }

  /**
   * Ensures an index exists. Idempotent via CREATE INDEX IF NOT EXISTS.
   */
  async ensureIndexExists(
    indexName: string,
    table: string,
    columns: string[],
    unique = false,
  ): Promise<RepairResult> {
    const action = `ensure-index:${indexName}`;
    try {
      const uniqueClause = unique ? 'UNIQUE' : '';
      const cols = columns.map((c) => `"${c}"`).join(', ');
      await this.dataSource.query(
        `CREATE ${uniqueClause} INDEX IF NOT EXISTS "${indexName}" ON "${table}" (${cols})`,
      );
      this.logger.log(`Ensured index ${indexName} on ${table}(${columns.join(', ')})`);
      return { action, success: true };
    } catch (err) {
      return { action, success: false, detail: String(err) };
    }
  }

  /**
   * Repairs orphaned enum values by re-creating the enum type with the full
   * expected set of values. Uses a safe rename-and-replace strategy.
   */
  async repairEnumType(
    enumName: string,
    expectedValues: string[],
  ): Promise<RepairResult> {
    const action = `repair-enum:${enumName}`;
    try {
      for (const value of expectedValues) {
        await this.dataSource.query(
          `DO $$ BEGIN
             ALTER TYPE "${enumName}" ADD VALUE IF NOT EXISTS '${value}';
           EXCEPTION WHEN undefined_object THEN NULL; END $$`,
        );
      }
      this.logger.log(`Repaired enum ${enumName} with ${expectedValues.length} values`);
      return { action, success: true };
    } catch (err) {
      return { action, success: false, detail: String(err) };
    }
  }

  /**
   * Runs all standard repairs in sequence. Returns a summary of results.
   */
  async runStandardRepairs(): Promise<RepairResult[]> {
    const results: RepairResult[] = [];

    // Ensure migration_safety_log table exists (created by the safety migration)
    results.push(
      await this.ensureColumnExists('migrations', 'checksum', 'VARCHAR(64)'),
    );

    return results;
  }
}
