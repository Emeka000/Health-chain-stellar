import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRetentionPolicyFields1840000002000 implements MigrationInterface {
  name = 'AddRetentionPolicyFields1840000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add anonymised flag to users
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "anonymised" boolean NOT NULL DEFAULT false
    `);

    // Add patientId to orders (regulatory requirement: strip after 10 years)
    await queryRunner.query(`
      ALTER TABLE "orders"
        ADD COLUMN IF NOT EXISTS "patient_id" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "anonymised"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN IF EXISTS "patient_id"`);
  }
}
