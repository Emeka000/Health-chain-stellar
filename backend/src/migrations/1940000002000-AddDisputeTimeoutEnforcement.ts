import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDisputeTimeoutEnforcement1940000002000
  implements MigrationInterface
{
  name = 'AddDisputeTimeoutEnforcement1940000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "timeout_owner" character varying(16) NOT NULL DEFAULT 'BACKEND'`,
    );
    await queryRunner.query(
      `ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "timeout_deadline_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "timeout_processed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "timeout_decision_reason" character varying(128)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_disputes_timeout_deadline_status" ON "disputes" ("timeout_deadline_at", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_disputes_timeout_deadline_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "disputes" DROP COLUMN IF EXISTS "timeout_decision_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "disputes" DROP COLUMN IF EXISTS "timeout_processed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "disputes" DROP COLUMN IF EXISTS "timeout_deadline_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "disputes" DROP COLUMN IF EXISTS "timeout_owner"`,
    );
  }
}
