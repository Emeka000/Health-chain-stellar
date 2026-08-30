import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUssdPinAuthToUsers1974000000000 implements MigrationInterface {
  name = 'AddUssdPinAuthToUsers1974000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN "ussd_pin_hash" varchar,
      ADD COLUMN "ussd_pin_failed_attempts" int NOT NULL DEFAULT 0,
      ADD COLUMN "ussd_pin_locked_until" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN "ussd_pin_hash",
      DROP COLUMN "ussd_pin_failed_attempts",
      DROP COLUMN "ussd_pin_locked_until"
    `);
  }
}
