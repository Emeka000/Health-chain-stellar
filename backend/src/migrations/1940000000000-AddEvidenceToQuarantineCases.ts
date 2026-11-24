import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEvidenceToQuarantineCases1940000000000 implements MigrationInterface {
  name = 'AddEvidenceToQuarantineCases1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('blood_unit_quarantine_cases');
    if (!hasTable) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "blood_unit_quarantine_cases"
      ADD COLUMN IF NOT EXISTS "evidence" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasTable = await queryRunner.hasTable('blood_unit_quarantine_cases');
    if (!hasTable) {
      return;
    }

    await queryRunner.query(`
      ALTER TABLE "blood_unit_quarantine_cases"
      DROP COLUMN IF EXISTS "evidence"
    `);
  }
}