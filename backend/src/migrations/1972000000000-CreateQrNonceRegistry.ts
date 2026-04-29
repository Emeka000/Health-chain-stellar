import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateQrNonceRegistry1972000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "qr_nonce_registry" (
        "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "nonce"        VARCHAR(64) NOT NULL,
        "unit_number"  VARCHAR(255) NOT NULL,
        "status"       VARCHAR(16) NOT NULL DEFAULT 'UNUSED',
        "expires_at"   TIMESTAMPTZ NOT NULL,
        "consumed_at"  TIMESTAMPTZ,
        "consumed_by"  VARCHAR(255),
        "offline_mode" BOOLEAN NOT NULL DEFAULT FALSE,
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_qr_nonce" UNIQUE ("nonce")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_qr_nonce_expires_at"
        ON "qr_nonce_registry" ("expires_at")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_qr_nonce_unit_number"
        ON "qr_nonce_registry" ("unit_number")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "qr_nonce_registry"`);
  }
}
