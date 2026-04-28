import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePartnerOnboardingsTable1820000005000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE onboarding_status AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'activated');
      CREATE TYPE onboarding_step AS ENUM ('profile', 'compliance', 'contacts', 'service_areas', 'wallet');

      CREATE TABLE partner_onboardings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        submitted_by VARCHAR NOT NULL,
        org_type VARCHAR NOT NULL,
        status onboarding_status NOT NULL DEFAULT 'draft',
        current_step onboarding_step NOT NULL DEFAULT 'profile',
        data JSONB NOT NULL DEFAULT '{}',
        rejection_reason TEXT,
        reviewed_by VARCHAR,
        reviewed_at TIMESTAMPTZ,
        organization_id UUID,
        contract_tx_hash VARCHAR,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IDX_ONBOARDING_STATUS ON partner_onboardings(status);
      CREATE INDEX IDX_ONBOARDING_SUBMITTED_BY ON partner_onboardings(submitted_by);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS partner_onboardings;
      DROP TYPE IF EXISTS onboarding_step;
      DROP TYPE IF EXISTS onboarding_status;
    `);
  }
}
