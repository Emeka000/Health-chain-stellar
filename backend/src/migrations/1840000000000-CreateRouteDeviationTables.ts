import { MigrationInterface, QueryRunner } from 'typeorm'; // eslint-disable-line import/named

export class CreateRouteDeviationTables1840000000000 implements MigrationInterface {
  name = 'CreateRouteDeviationTables1840000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "planned_routes" (
        "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id"             VARCHAR(64)  NOT NULL,
        "rider_id"             VARCHAR(64)  NOT NULL,
        "polyline"             TEXT         NOT NULL,
        "checkpoints"          JSONB        NOT NULL DEFAULT '[]',
        "corridor_radius_m"    INT          NOT NULL DEFAULT 300,
        "max_deviation_seconds" INT         NOT NULL DEFAULT 120,
        "is_active"            BOOLEAN      NOT NULL DEFAULT TRUE,
        "created_at"           TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_planned_routes_order_id" ON "planned_routes" ("order_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_planned_routes_rider_id" ON "planned_routes" ("rider_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_planned_routes_active"   ON "planned_routes" ("is_active")`,
    );

    await queryRunner.query(`
      CREATE TYPE "deviation_severity_enum" AS ENUM ('minor', 'moderate', 'severe')
    `);
    await queryRunner.query(`
      CREATE TYPE "deviation_status_enum" AS ENUM ('open', 'acknowledged', 'resolved')
    `);

    await queryRunner.query(`
      CREATE TABLE "route_deviation_incidents" (
        "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "order_id"              VARCHAR(64)  NOT NULL,
        "rider_id"              VARCHAR(64)  NOT NULL,
        "planned_route_id"      UUID         NOT NULL,
        "severity"              "deviation_severity_enum" NOT NULL DEFAULT 'minor',
        "status"                "deviation_status_enum"   NOT NULL DEFAULT 'open',
        "deviation_distance_m"  FLOAT        NOT NULL,
        "deviation_duration_s"  INT          NOT NULL DEFAULT 0,
        "last_known_latitude"   DECIMAL(10,7) NOT NULL,
        "last_known_longitude"  DECIMAL(10,7) NOT NULL,
        "reason"                TEXT,
        "recommended_action"    TEXT,
        "acknowledged_by"       VARCHAR(64),
        "acknowledged_at"       TIMESTAMPTZ,
        "resolved_at"           TIMESTAMPTZ,
        "scoring_applied"       BOOLEAN      NOT NULL DEFAULT FALSE,
        "metadata"              JSONB,
        "created_at"            TIMESTAMPTZ  NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "idx_deviation_order_id"   ON "route_deviation_incidents" ("order_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_deviation_rider_id"   ON "route_deviation_incidents" ("rider_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_deviation_status"     ON "route_deviation_incidents" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_deviation_created_at" ON "route_deviation_incidents" ("created_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "route_deviation_incidents"`);
    await queryRunner.query(`DROP TYPE  IF EXISTS "deviation_status_enum"`);
    await queryRunner.query(`DROP TYPE  IF EXISTS "deviation_severity_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "planned_routes"`);
  }
}
