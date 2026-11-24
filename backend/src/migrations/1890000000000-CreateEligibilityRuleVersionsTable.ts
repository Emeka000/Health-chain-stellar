import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEligibilityRuleVersionsTable1890000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "eligibility_rule_predicate_type_enum" AS ENUM (
        'age_range', 'donation_interval', 'deferral_check', 'health_screening', 'custom'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "eligibility_rule_versions" (
        "id"               UUID NOT NULL DEFAULT uuid_generate_v4(),
        "rule_key"         VARCHAR NOT NULL,
        "version"          INT NOT NULL DEFAULT 1,
        "predicate_type"   "eligibility_rule_predicate_type_enum" NOT NULL,
        "description"      TEXT NOT NULL,
        "config"           JSONB NOT NULL DEFAULT '{}',
        "effective_from"   TIMESTAMPTZ NOT NULL,
        "effective_until"  TIMESTAMPTZ,
        "is_active"        BOOLEAN NOT NULL DEFAULT true,
        "created_by"       VARCHAR,
        "provenance_hash"  VARCHAR,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_eligibility_rule_versions" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_erv_rule_key_effective_from" ON "eligibility_rule_versions" ("rule_key", "effective_from")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_erv_is_active" ON "eligibility_rule_versions" ("is_active")
    `);

    // Add override and rule version tracking columns to donor_deferrals
    await queryRunner.query(`
      ALTER TABLE "donor_deferrals"
        ADD COLUMN IF NOT EXISTS "override_approver_id" VARCHAR,
        ADD COLUMN IF NOT EXISTS "override_reason"      TEXT,
        ADD COLUMN IF NOT EXISTS "rule_version_id"      VARCHAR
    `);

    // Store donor date of birth on the donor profile so age checks can be
    // evaluated server-side instead of trusting client-supplied values.
    await queryRunner.query(`
      ALTER TABLE "donor_profiles"
        ADD COLUMN IF NOT EXISTS "date_of_birth" DATE
    `);

    // Seed default eligibility rules so predicates run on a fresh database.
    await queryRunner.query(
      `
      INSERT INTO "eligibility_rule_versions"
        ("rule_key", "version", "predicate_type", "description", "config", "effective_from", "is_active")
      VALUES
        ('age_range', 1, 'age_range', 'Donor must be within the eligible age range',
         '{"minAge": 18, "maxAge": 65}'::jsonb, now(), true),
        ('donation_interval', 1, 'donation_interval', 'Donor must wait the minimum interval between donations',
         '{"minIntervalDays": 56}'::jsonb, now(), true)
      `,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "eligibility_rule_versions" WHERE "rule_key" IN ('age_range', 'donation_interval') AND "version" = 1`,
    );
    await queryRunner.query(`ALTER TABLE "donor_profiles" DROP COLUMN IF EXISTS "date_of_birth"`);
    await queryRunner.query(`ALTER TABLE "donor_deferrals" DROP COLUMN IF EXISTS "rule_version_id"`);
    await queryRunner.query(`ALTER TABLE "donor_deferrals" DROP COLUMN IF EXISTS "override_reason"`);
    await queryRunner.query(`ALTER TABLE "donor_deferrals" DROP COLUMN IF EXISTS "override_approver_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "eligibility_rule_versions"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "eligibility_rule_predicate_type_enum"`);
  }
}
