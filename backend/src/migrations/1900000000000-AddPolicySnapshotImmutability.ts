import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPolicySnapshotImmutability1900000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE policy_versions
        ADD COLUMN IF NOT EXISTS rules_hash VARCHAR(64),
        ADD COLUMN IF NOT EXISTS immutable BOOLEAN NOT NULL DEFAULT FALSE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE policy_versions
        DROP COLUMN IF EXISTS rules_hash,
        DROP COLUMN IF EXISTS immutable
    `);
  }
}
