import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProofBundleManifest1890000000000 implements MigrationInterface {
  name = 'AddProofBundleManifest1890000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE proof_bundles
        ADD COLUMN IF NOT EXISTS manifest jsonb,
        ADD COLUMN IF NOT EXISTS manifest_root_digest varchar(64),
        ADD COLUMN IF NOT EXISTS verifier_identity varchar(255),
        ADD COLUMN IF NOT EXISTS verification_report jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE proof_bundles
        DROP COLUMN IF EXISTS manifest,
        DROP COLUMN IF EXISTS manifest_root_digest,
        DROP COLUMN IF EXISTS verifier_identity,
        DROP COLUMN IF EXISTS verification_report
    `);
  }
}
