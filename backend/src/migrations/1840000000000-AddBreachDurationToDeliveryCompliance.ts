import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBreachDurationToDeliveryCompliance1840000000000 implements MigrationInterface {
  name = 'AddBreachDurationToDeliveryCompliance1840000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delivery_compliance"
        ADD COLUMN IF NOT EXISTS "breach_duration_minutes" float NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "breach_started_at" timestamptz,
        ADD COLUMN IF NOT EXISTS "suspension_triggered" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "delivery_compliance"
        DROP COLUMN IF EXISTS "breach_duration_minutes",
        DROP COLUMN IF EXISTS "breach_started_at",
        DROP COLUMN IF EXISTS "suspension_triggered"
    `);
  }
}
