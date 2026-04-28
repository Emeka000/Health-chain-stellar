import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFileMetadataAntiTamper1890000001000 implements MigrationInterface {
  name = 'AddFileMetadataAntiTamper1890000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE file_metadata
        ADD COLUMN IF NOT EXISTS metadata_version int NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz,
        ADD COLUMN IF NOT EXISTS legal_hold boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS legal_hold_by varchar(255),
        ADD COLUMN IF NOT EXISTS legal_hold_reason text
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS file_metadata_audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        file_id uuid NOT NULL,
        version int NOT NULL,
        actor_id varchar(255) NOT NULL,
        reason text NOT NULL,
        previous_values jsonb,
        new_values jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_fmal_file_id ON file_metadata_audit_log (file_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_fmal_actor ON file_metadata_audit_log (actor_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS file_metadata_audit_log`);
    await queryRunner.query(`
      ALTER TABLE file_metadata
        DROP COLUMN IF EXISTS metadata_version,
        DROP COLUMN IF EXISTS retention_expires_at,
        DROP COLUMN IF EXISTS legal_hold,
        DROP COLUMN IF EXISTS legal_hold_by,
        DROP COLUMN IF EXISTS legal_hold_reason
    `);
  }
}
