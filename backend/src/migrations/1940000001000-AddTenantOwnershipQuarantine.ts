import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantOwnershipQuarantine1940000001000
  implements MigrationInterface
{
  name = 'AddTenantOwnershipQuarantine1940000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tenant_ownership_quarantine" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "resource_type" character varying(64) NOT NULL,
        "resource_id" character varying(128) NOT NULL,
        "reason" character varying(255) NOT NULL,
        "metadata" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tenant_ownership_quarantine_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_tenant_ownership_quarantine_resource" ON "tenant_ownership_quarantine" ("resource_type", "resource_id")`,
    );

    await queryRunner.query(`
      INSERT INTO "tenant_ownership_quarantine" ("resource_type", "resource_id", "reason", "metadata")
      SELECT 'incident_review', ir.id::text, 'Missing tenant owner fields', jsonb_build_object('hospitalId', ir.hospital_id, 'bloodBankId', ir.blood_bank_id)
      FROM "incident_reviews" ir
      WHERE ir.hospital_id IS NULL AND ir.blood_bank_id IS NULL
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "tenant_ownership_quarantine" ("resource_type", "resource_id", "reason")
      SELECT 'escalation', e.id::text, 'Missing hospital owner'
      FROM "escalations" e
      WHERE e.hospital_id IS NULL
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_tenant_ownership_quarantine_resource"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_ownership_quarantine"`);
  }
}
