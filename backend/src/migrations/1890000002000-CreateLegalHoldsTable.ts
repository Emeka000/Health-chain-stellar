import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLegalHoldsTable1890000002000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "legal_hold_status_enum" AS ENUM ('active', 'released')
    `);

    await queryRunner.query(`
      CREATE TABLE "legal_holds" (
        "id"           UUID NOT NULL DEFAULT uuid_generate_v4(),
        "entity_type"  VARCHAR NOT NULL,
        "entity_id"    VARCHAR NOT NULL,
        "reason"       TEXT NOT NULL,
        "placed_by"    VARCHAR NOT NULL,
        "status"       "legal_hold_status_enum" NOT NULL DEFAULT 'active',
        "released_by"  VARCHAR,
        "released_at"  TIMESTAMPTZ,
        "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_legal_holds" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_legal_holds_entity" ON "legal_holds" ("entity_type", "entity_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_legal_holds_status" ON "legal_holds" ("status")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "legal_holds"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "legal_hold_status_enum"`);
  }
}
