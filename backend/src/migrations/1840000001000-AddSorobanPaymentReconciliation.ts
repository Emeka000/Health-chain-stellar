import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSorobanPaymentReconciliation1840000001000 implements MigrationInterface {
  name = 'AddSorobanPaymentReconciliation1840000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add payment fields to orders
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "on_chain_payment_id" varchar,
        ADD COLUMN IF NOT EXISTS "payment_status" varchar
    `);

    // Indexer state table (stores last processed ledger per job)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "soroban_indexer_state" (
        "key" varchar(100) NOT NULL,
        "last_ledger_sequence" bigint NOT NULL DEFAULT 0,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_soroban_indexer_state" PRIMARY KEY ("key")
      )
    `);

    // Reconciliation log table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "soroban_reconciliation_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "on_chain_payment_id" varchar NOT NULL,
        "order_id" uuid,
        "event_type" varchar NOT NULL,
        "ledger_sequence" bigint NOT NULL,
        "on_chain_payment_status" varchar NOT NULL,
        "off_chain_payment_status" varchar,
        "status" varchar NOT NULL DEFAULT 'resolved',
        "discrepancy_detail" text,
        "resolved_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_soroban_reconciliation_logs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_recon_log_payment_id" ON "soroban_reconciliation_logs" ("on_chain_payment_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_recon_log_status" ON "soroban_reconciliation_logs" ("status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_recon_log_ledger" ON "soroban_reconciliation_logs" ("ledger_sequence")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "soroban_reconciliation_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "soroban_indexer_state"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "on_chain_payment_id", DROP COLUMN IF EXISTS "payment_status"`);
  }
}
