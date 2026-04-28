import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisputeResolutionMetadata1870000000000 implements MigrationInterface {
  name = 'AddDisputeResolutionMetadata1870000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'dispute_outcome_enum') THEN
          CREATE TYPE dispute_outcome_enum AS ENUM ('payer_win', 'payee_win', 'dismissed');
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "disputes"
        ADD COLUMN IF NOT EXISTS "outcome" dispute_outcome_enum,
        ADD COLUMN IF NOT EXISTS "resolved_by" varchar,
        ADD COLUMN IF NOT EXISTS "evidence_digest" varchar(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "disputes"
        DROP COLUMN IF EXISTS "outcome",
        DROP COLUMN IF EXISTS "resolved_by",
        DROP COLUMN IF EXISTS "evidence_digest"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS dispute_outcome_enum`);
  }
}
