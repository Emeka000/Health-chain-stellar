import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrgTrustScoreTables1890000003000 implements MigrationInterface {
  name = 'CreateOrgTrustScoreTables1890000003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS org_trust_scores (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL UNIQUE,
        score float NOT NULL DEFAULT 0,
        version int NOT NULL DEFAULT 1,
        feature_snapshot jsonb,
        explanation jsonb,
        suspicious_rating_flag boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_org_trust_org_id ON org_trust_scores (organization_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS org_trust_score_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL,
        version int NOT NULL,
        score float NOT NULL,
        feature_snapshot jsonb NOT NULL,
        explanation jsonb NOT NULL,
        suspicious_rating_flag boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_org_trust_hist_org_id ON org_trust_score_history (organization_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS org_trust_score_history`);
    await queryRunner.query(`DROP TABLE IF EXISTS org_trust_scores`);
  }
}
