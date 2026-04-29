import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrgVerificationLifecycle1960000000000
  implements MigrationInterface
{
  async up(queryRunner: QueryRunner): Promise<void> {
    // Extend existing status enum with new lifecycle states
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE organization_verification_status
          ADD VALUE IF NOT EXISTS 'suspended';
      EXCEPTION WHEN undefined_object THEN NULL; END $$
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        ALTER TYPE organization_verification_status
          ADD VALUE IF NOT EXISTS 'unverified';
      EXCEPTION WHEN undefined_object THEN NULL; END $$
    `);

    // Verification change reason enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE verification_change_reason AS ENUM (
          'documents_verified','compliance_confirmed',
          'incomplete_documents','license_invalid','failed_compliance',
          'compliance_breach','fraud_investigation','regulatory_hold','safety_concern',
          'investigation_cleared','compliance_restored',
          'license_expired','repeated_violations','voluntary_exit','grace_period_expired',
          'reapplication'
        );
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // In-flight conflict policy enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE in_flight_conflict_policy AS ENUM ('drain','cancel_all','flag_for_review');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // Restriction level enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE restriction_level AS ENUM ('none','new_orders_blocked','fully_restricted');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // Grace period state enum
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE grace_period_state AS ENUM ('active','expired','cancelled');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$
    `);

    // Immutable verification history table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS org_verification_history (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id     UUID NOT NULL,
        from_status         VARCHAR(40),
        to_status           VARCHAR(40) NOT NULL,
        actor_id            VARCHAR NOT NULL,
        reason              verification_change_reason NOT NULL,
        note                TEXT,
        in_flight_order_ids JSONB,
        conflict_policy     in_flight_conflict_policy,
        restriction_level   restriction_level,
        blockchain_tx_hash  VARCHAR(128),
        transitioned_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_org_vh_org
        ON org_verification_history (organization_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_org_vh_org_status
        ON org_verification_history (organization_id, to_status)
    `);

    // Grace period table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS org_grace_periods (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id     UUID NOT NULL,
        target_status       VARCHAR(40) NOT NULL,
        state               grace_period_state NOT NULL DEFAULT 'active',
        restriction_level   restriction_level NOT NULL DEFAULT 'new_orders_blocked',
        expires_at          TIMESTAMPTZ NOT NULL,
        fully_restricted_at TIMESTAMPTZ,
        actor_id            VARCHAR NOT NULL,
        note                TEXT,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_org_gp_org_state
        ON org_grace_periods (organization_id, state)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_org_gp_expires
        ON org_grace_periods (expires_at)
        WHERE state = 'active'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS org_grace_periods`);
    await queryRunner.query(`DROP TABLE IF EXISTS org_verification_history`);
    await queryRunner.query(`DROP TYPE IF EXISTS grace_period_state`);
    await queryRunner.query(`DROP TYPE IF EXISTS restriction_level`);
    await queryRunner.query(`DROP TYPE IF EXISTS in_flight_conflict_policy`);
    await queryRunner.query(`DROP TYPE IF EXISTS verification_change_reason`);
  }
}
