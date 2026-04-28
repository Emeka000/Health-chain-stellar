import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReconciliationEngine1890000002000 implements MigrationInterface {
  name = 'AddReconciliationEngine1890000002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns to reconciliation_runs
    await queryRunner.query(`
      ALTER TABLE reconciliation_runs
        ADD COLUMN IF NOT EXISTS snapshot_id uuid,
        ADD COLUMN IF NOT EXISTS idempotency_key varchar(128) UNIQUE
    `);

    // Add INTERRUPTED to the status enum
    await queryRunner.query(`
      ALTER TYPE reconciliation_run_status_enum ADD VALUE IF NOT EXISTS 'interrupted'
    `);

    // Add new columns to reconciliation_mismatches
    await queryRunner.query(`
      ALTER TABLE reconciliation_mismatches
        ADD COLUMN IF NOT EXISTS exception_category varchar(64),
        ADD COLUMN IF NOT EXISTS match_score float,
        ADD COLUMN IF NOT EXISTS remediation_hint text
    `);

    // Add DUPLICATE and AMBIGUOUS to mismatch type enum
    await queryRunner.query(`
      ALTER TYPE reconciliation_mismatches_type_enum ADD VALUE IF NOT EXISTS 'duplicate'
    `);
    await queryRunner.query(`
      ALTER TYPE reconciliation_mismatches_type_enum ADD VALUE IF NOT EXISTS 'ambiguous'
    `);

    // Create reconciliation_snapshots table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_snapshots (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id uuid NOT NULL,
        status varchar(32) NOT NULL DEFAULT 'in_progress',
        cursors jsonb NOT NULL DEFAULT '{}',
        processed_counts jsonb NOT NULL DEFAULT '{}',
        exception_summary jsonb NOT NULL DEFAULT '{}',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_recon_snapshots_run_id ON reconciliation_snapshots (run_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_recon_snapshots_status ON reconciliation_snapshots (status)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS reconciliation_snapshots`);
    await queryRunner.query(`
      ALTER TABLE reconciliation_mismatches
        DROP COLUMN IF EXISTS exception_category,
        DROP COLUMN IF EXISTS match_score,
        DROP COLUMN IF EXISTS remediation_hint
    `);
    await queryRunner.query(`
      ALTER TABLE reconciliation_runs
        DROP COLUMN IF EXISTS snapshot_id,
        DROP COLUMN IF EXISTS idempotency_key
    `);
  }
}
