import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `urgency` enum column to `blood_requests` and a supporting index.
 * The column already exists on the entity (RequestUrgency enum) — this migration
 * ensures the DB schema is in sync for environments that do not use synchronize:true.
 */
export class AddUrgencyToBloodRequests1830000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create the enum type if it doesn't exist yet
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE request_urgency_enum AS ENUM ('CRITICAL', 'URGENT', 'ROUTINE', 'SCHEDULED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Add column only if it doesn't already exist
    await queryRunner.query(`
      ALTER TABLE blood_requests
        ADD COLUMN IF NOT EXISTS urgency request_urgency_enum NOT NULL DEFAULT 'ROUTINE';
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_blood_requests_urgency ON blood_requests (urgency);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_blood_requests_urgency`);
    await queryRunner.query(`ALTER TABLE blood_requests DROP COLUMN IF EXISTS urgency`);
  }
}
