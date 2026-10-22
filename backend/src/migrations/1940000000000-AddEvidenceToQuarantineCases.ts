import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEvidenceToQuarantineCases1940000000000 implements MigrationInterface {
  name = 'AddEvidenceToQuarantineCases1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "blood_unit_quarantine_cases"
      ADD COLUMN "evidence" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "blood_unit_quarantine_cases"
      DROP COLUMN "evidence"
    `);
  }
}