import { MigrationInterface, QueryRunner } from 'typeorm'; // eslint-disable-line import/named

export class CreateReadinessTables1860000000000 implements MigrationInterface {
  name = 'CreateReadinessTables1860000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "readiness_entity_type_enum" AS ENUM ('partner', 'region')
    `);
    await queryRunner.query(`
      CREATE TYPE "readiness_checklist_status_enum" AS ENUM ('incomplete', 'ready', 'signed_off')
    `);
    await queryRunner.query(`
      CREATE TYPE "readiness_item_key_enum" AS ENUM (
        'licensing', 'staffing', 'storage', 'transport_coverage',
        'notification_setup', 'permissions', 'wallet_linkage', 'emergency_contacts'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "readiness_item_status_enum" AS ENUM ('pending', 'complete', 'waived')
    `);

    await queryRunner.query(`
      CREATE TABLE "readiness_checklists" (
        "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "entity_type"     "readiness_entity_type_enum"      NOT NULL,
        "entity_id"       VARCHAR(64)                       NOT NULL,
        "status"          "readiness_checklist_status_enum" NOT NULL DEFAULT 'incomplete',
        "signed_off_by"   VARCHAR(64),
        "signed_off_at"   TIMESTAMPTZ,
        "reviewer_notes"  TEXT,
        "created_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "uq_rc_entity" UNIQUE ("entity_type", "entity_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_rc_status" ON "readiness_checklists" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "readiness_items" (
        "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "checklist_id"  UUID NOT NULL REFERENCES "readiness_checklists"("id") ON DELETE CASCADE,
        "item_key"      "readiness_item_key_enum"    NOT NULL,
        "status"        "readiness_item_status_enum" NOT NULL DEFAULT 'pending',
        "evidence_url"  TEXT,
        "notes"         TEXT,
        "completed_at"  TIMESTAMPTZ,
        "completed_by"  VARCHAR(64),
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_ri_checklist" ON "readiness_items" ("checklist_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_ri_status"    ON "readiness_items" ("status")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "readiness_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "readiness_checklists"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "readiness_item_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "readiness_item_key_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "readiness_checklist_status_enum"`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "readiness_entity_type_enum"`);
  }
}
