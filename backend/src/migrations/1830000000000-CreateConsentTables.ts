import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConsentTables1830000000000 implements MigrationInterface {
  name = 'CreateConsentTables1830000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "consent_terms" (
        "id"             UUID NOT NULL DEFAULT uuid_generate_v4(),
        "version_label"  VARCHAR(32) NOT NULL,
        "version_hash"   VARCHAR(64) NOT NULL,
        "change_summary" TEXT,
        "is_active"      BOOLEAN NOT NULL DEFAULT false,
        "published_at"   TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_consent_terms" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_consent_terms_hash" UNIQUE ("version_hash")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_CONSENT_TERMS_ACTIVE" ON "consent_terms" ("is_active")
    `);

    await queryRunner.query(`
      CREATE TABLE "consent_records" (
        "id"                    UUID NOT NULL DEFAULT uuid_generate_v4(),
        "participant_id"        UUID NOT NULL,
        "consent_term_id"       UUID NOT NULL,
        "version_hash_at_consent" VARCHAR(64) NOT NULL,
        "is_active"             BOOLEAN NOT NULL DEFAULT true,
        "consent_source"        VARCHAR(255),
        "consented_at"          TIMESTAMP NOT NULL DEFAULT now(),
        "revoked_at"            TIMESTAMP,
        CONSTRAINT "PK_consent_records" PRIMARY KEY ("id"),
        CONSTRAINT "FK_consent_records_term"
          FOREIGN KEY ("consent_term_id") REFERENCES "consent_terms"("id")
          ON DELETE RESTRICT
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_CONSENT_RECORDS_PARTICIPANT" ON "consent_records" ("participant_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_CONSENT_RECORDS_TERM" ON "consent_records" ("consent_term_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_CONSENT_RECORDS_ACTIVE"
        ON "consent_records" ("participant_id", "is_active")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "consent_records"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "consent_terms"`);
  }
}
