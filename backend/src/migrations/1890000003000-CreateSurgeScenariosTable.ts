import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSurgeScenariosTable1890000003000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "surge_scenario_status_enum" AS ENUM ('pending', 'running', 'completed', 'failed')
    `);

    await queryRunner.query(`
      CREATE TABLE "surge_scenarios" (
        "id"                           UUID NOT NULL DEFAULT uuid_generate_v4(),
        "name"                         VARCHAR NOT NULL,
        "description"                  TEXT,
        "seed"                         BIGINT NOT NULL,
        "surge_demand_units"           INT NOT NULL,
        "override_stock_units"         INT,
        "override_rider_capacity_units" INT,
        "units_per_rider"              DECIMAL(5,2) NOT NULL DEFAULT 4,
        "policy_config"                JSONB NOT NULL DEFAULT '{}',
        "outcome"                      JSONB,
        "status"                       "surge_scenario_status_enum" NOT NULL DEFAULT 'pending',
        "created_by"                   VARCHAR,
        "created_at"                   TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"                   TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "pk_surge_scenarios" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "idx_surge_scenarios_status" ON "surge_scenarios" ("status")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "surge_scenarios"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "surge_scenario_status_enum"`);
  }
}
