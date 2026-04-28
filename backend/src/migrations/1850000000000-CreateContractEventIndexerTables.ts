import { MigrationInterface, QueryRunner } from 'typeorm'; // eslint-disable-line import/named

export class CreateContractEventIndexerTables1850000000000 implements MigrationInterface {
  name = 'CreateContractEventIndexerTables1850000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "contract_domain_enum" AS ENUM (
        'identity', 'request', 'inventory', 'delivery', 'payment'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "contract_events" (
        "id"               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "domain"           "contract_domain_enum" NOT NULL,
        "event_type"       VARCHAR(100) NOT NULL,
        "contract_ref"     VARCHAR(128),
        "ledger_sequence"  BIGINT       NOT NULL,
        "tx_hash"          VARCHAR(128),
        "payload"          JSONB        NOT NULL DEFAULT '{}',
        "dedup_key"        VARCHAR(64)  NOT NULL,
        "entity_ref"       VARCHAR(128),
        "indexed_at"       TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT "uq_contract_events_dedup_key" UNIQUE ("dedup_key")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_ce_domain_type"   ON "contract_events" ("domain", "event_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ce_ledger"        ON "contract_events" ("ledger_sequence")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ce_contract_ref"  ON "contract_events" ("contract_ref")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ce_indexed_at"    ON "contract_events" ("indexed_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ce_entity_ref"    ON "contract_events" ("entity_ref")`,
    );

    await queryRunner.query(`
      CREATE TABLE "contract_indexer_cursors" (
        "id"          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "domain"      VARCHAR(50) NOT NULL,
        "last_ledger" BIGINT      NOT NULL DEFAULT 0,
        "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_indexer_cursor_domain" UNIQUE ("domain")
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "contract_indexer_cursors"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "contract_events"`);
    await queryRunner.query(`DROP TYPE  IF EXISTS "contract_domain_enum"`);
  }
}
