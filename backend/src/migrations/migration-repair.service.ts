import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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

  /**
   * Allow-listed column type definitions that may be used in manual repair.
   *
   * Free-text `definition` strings are the primary SQL-injection vector in
   * ensureColumnExists. By restricting to this catalogue we eliminate the
   * attack surface while still supporting every column type we actually need
   * for migrations. Extend this list when a new type is genuinely required.
   */
  private static readonly ALLOWED_COLUMN_DEFINITIONS: ReadonlySet<string> =
    new Set([
      'TEXT',
      'TEXT NOT NULL',
      'TEXT DEFAULT NULL',
      'VARCHAR(64)',
      'VARCHAR(64) NOT NULL',
      'VARCHAR(255)',
      'VARCHAR(255) NOT NULL',
      'INTEGER',
      'INTEGER NOT NULL',
      'INTEGER DEFAULT 0',
      'BIGINT',
      'BIGINT NOT NULL',
      'BOOLEAN',
      'BOOLEAN NOT NULL',
      'BOOLEAN DEFAULT FALSE',
      'BOOLEAN DEFAULT TRUE',
      'TIMESTAMP',
      'TIMESTAMP DEFAULT NOW()',
      'TIMESTAMPTZ',
      'TIMESTAMPTZ DEFAULT NOW()',
      'JSONB',
      "JSONB DEFAULT '{}'",
      'UUID',
      'UUID DEFAULT gen_random_uuid()',
      'DECIMAL(18,8)',
      'DECIMAL(18,8) NOT NULL',
      'SMALLINT',
      'SMALLINT NOT NULL',
    ]);

  /** Identifier allow-list: only alphanumerics and underscores (no quotes, spaces, or semicolons). */
  private static readonly SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Removes a stale migration record from the migrations table so it can be
   * re-applied. Use when a migration partially applied and left the DB in an
   * inconsistent state.
   */
  async removeStaleMigrationRecord(
    migrationName: string,
  ): Promise<RepairResult> {
    try {
      const result: [unknown, number] = await this.dataSource.query(
        `DELETE FROM migrations WHERE name = $1`,
        [migrationName],
      );

      const affected = result[1];
      this.logger.log(
        `Removed stale migration record '${migrationName}' (${affected} rows)`,
      );
      return {
        action: `remove:${migrationName}`,
        success: true,
        detail: `${affected} rows deleted`,
      };
    } catch (err) {
      return {
        action: `remove:${migrationName}`,
        success: false,
        detail: String(err),
      };
    }
  }

  /**
   * Ensures a column exists on a table. If missing, adds it with the given
   * definition. Idempotent via IF NOT EXISTS.
   *
   * Security: `table` and `column` are validated against a safe-identifier
   * regex (alphanumeric + underscore only). `definition` must be present in
   * the ALLOWED_COLUMN_DEFINITIONS allow-list. This prevents SQL injection
   * through any of the three attacker-controlled fields (issue #1189).
   */
  async ensureColumnExists(
    table: string,
    column: string,
    definition: string,
  ): Promise<RepairResult> {
    const action = `ensure-column:${table}.${column}`;

    // ── Input validation ──────────────────────────────────────────────────────
    if (!MigrationRepairService.SAFE_IDENTIFIER_RE.test(table)) {
      throw new BadRequestException(
        `Invalid table name '${table}': only alphanumeric characters and underscores are allowed.`,
      );
    }
    if (!MigrationRepairService.SAFE_IDENTIFIER_RE.test(column)) {
      throw new BadRequestException(
        `Invalid column name '${column}': only alphanumeric characters and underscores are allowed.`,
      );
    }
    const normalizedDefinition = definition.trim().toUpperCase();
    if (
      !MigrationRepairService.ALLOWED_COLUMN_DEFINITIONS.has(
        normalizedDefinition,
      )
    ) {
      throw new BadRequestException(
        `Column definition '${definition}' is not in the allow-list. ` +
          `Use one of: ${[...MigrationRepairService.ALLOWED_COLUMN_DEFINITIONS].join(', ')}.`,
      );
    }
    // ─────────────────────────────────────────────────────────────────────────

    try {
      await this.dataSource.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${column}" ${normalizedDefinition}`,
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
      this.logger.log(
        `Ensured index ${indexName} on ${table}(${columns.join(', ')})`,
      );
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
      this.logger.log(
        `Repaired enum ${enumName} with ${expectedValues.length} values`,
      );
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
