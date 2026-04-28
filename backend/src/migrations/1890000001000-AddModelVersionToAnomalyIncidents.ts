import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddModelVersionToAnomalyIncidents1890000001000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "anomaly_incidents"
        ADD COLUMN IF NOT EXISTS "model_version" VARCHAR
    `);

    // Add MODEL_DRIFT to the anomaly type enum
    await queryRunner.query(`
      ALTER TYPE "anomaly_incidents_type_enum" ADD VALUE IF NOT EXISTS 'MODEL_DRIFT'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "anomaly_incidents" DROP COLUMN IF EXISTS "model_version"`);
  }
}
