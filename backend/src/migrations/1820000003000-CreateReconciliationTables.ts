import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReconciliationTables1820000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE reconciliation_run_status AS ENUM ('running', 'completed', 'failed');
      CREATE TYPE mismatch_type AS ENUM (
        'amount', 'status', 'parties', 'timestamp',
        'proof_ref', 'missing_on_chain', 'missing_off_chain'
      );
      CREATE TYPE mismatch_severity AS ENUM ('low', 'medium', 'high');
      CREATE TYPE mismatch_resolution AS ENUM ('pending', 'resynced', 'manual', 'dismissed');

      CREATE TABLE reconciliation_runs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        status reconciliation_run_status NOT NULL DEFAULT 'running',
        triggered_by VARCHAR,
        total_checked INT NOT NULL DEFAULT 0,
        mismatch_count INT NOT NULL DEFAULT 0,
        completed_at TIMESTAMPTZ,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE reconciliation_mismatches (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        run_id UUID NOT NULL REFERENCES reconciliation_runs(id) ON DELETE CASCADE,
        reference_id VARCHAR NOT NULL,
        reference_type VARCHAR NOT NULL,
        type mismatch_type NOT NULL,
        severity mismatch_severity NOT NULL DEFAULT 'medium',
        on_chain_value JSONB,
        off_chain_value JSONB,
        resolution mismatch_resolution NOT NULL DEFAULT 'pending',
        resolved_by VARCHAR,
        resolved_at TIMESTAMPTZ,
        resolution_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IDX_RECON_RUNS_STATUS ON reconciliation_runs(status);
      CREATE INDEX IDX_RECON_RUNS_CREATED ON reconciliation_runs(created_at);
      CREATE INDEX IDX_RECON_MISMATCHES_RUN ON reconciliation_mismatches(run_id);
      CREATE INDEX IDX_RECON_MISMATCHES_RESOLUTION ON reconciliation_mismatches(resolution);
      CREATE INDEX IDX_RECON_MISMATCHES_REF ON reconciliation_mismatches(reference_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS reconciliation_mismatches;
      DROP TABLE IF EXISTS reconciliation_runs;
      DROP TYPE IF EXISTS mismatch_resolution;
      DROP TYPE IF EXISTS mismatch_severity;
      DROP TYPE IF EXISTS mismatch_type;
      DROP TYPE IF EXISTS reconciliation_run_status;
    `);
  }
}
