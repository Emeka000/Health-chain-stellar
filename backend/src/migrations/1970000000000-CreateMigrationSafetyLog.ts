import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the migration_safety_log table used to record preflight check
 * results and integrity snapshots for forward-only migration auditing.
 */
export class CreateMigrationSafetyLog1970000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "migration_safety_log" (
        "id"              SERIAL PRIMARY KEY,
        "run_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "all_passed"      BOOLEAN NOT NULL,
        "total_checks"    INTEGER NOT NULL DEFAULT 0,
        "failed_checks"   JSONB NOT NULL DEFAULT '[]',
        "integrity_hash"  VARCHAR(64),
        "pending_count"   INTEGER NOT NULL DEFAULT 0,
        "metadata"        JSONB
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_migration_safety_log_run_at"
        ON "migration_safety_log" ("run_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "migration_safety_log"`);
  }
}
