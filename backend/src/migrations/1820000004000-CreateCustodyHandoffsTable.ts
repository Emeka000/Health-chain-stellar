import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustodyHandoffsTable1820000004000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE custody_actor AS ENUM ('blood_bank', 'rider', 'hospital');
      CREATE TYPE custody_handoff_status AS ENUM ('pending', 'confirmed', 'cancelled');

      CREATE TABLE custody_handoffs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        blood_unit_id VARCHAR NOT NULL,
        order_id VARCHAR,
        from_actor_id VARCHAR NOT NULL,
        from_actor_type custody_actor NOT NULL,
        to_actor_id VARCHAR NOT NULL,
        to_actor_type custody_actor NOT NULL,
        status custody_handoff_status NOT NULL DEFAULT 'pending',
        latitude FLOAT,
        longitude FLOAT,
        proof_reference VARCHAR,
        contract_event_id VARCHAR,
        confirmed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IDX_CUSTODY_BLOOD_UNIT ON custody_handoffs(blood_unit_id);
      CREATE INDEX IDX_CUSTODY_ORDER ON custody_handoffs(order_id);
      CREATE INDEX IDX_CUSTODY_STATUS ON custody_handoffs(status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS custody_handoffs;
      DROP TYPE IF EXISTS custody_handoff_status;
      DROP TYPE IF EXISTS custody_actor;
    `);
  }
}
