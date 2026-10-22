import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnhanceEscalationAutomation1940000000000
  implements MigrationInterface
{
  name = 'EnhanceEscalationAutomation1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "escalations" ADD "policy_chain" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "escalations" ADD "current_level" integer NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "escalations" ADD "next_escalation_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "escalations" ADD "status" character varying(24) NOT NULL DEFAULT 'OPEN'`,
    );
    await queryRunner.query(
      `ALTER TABLE "escalations" ADD "incident_review_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "escalations" ADD "remediation_task_id" character varying(128)`,
    );
    await queryRunner.query(
      `ALTER TABLE "escalations" ADD "updated_at" TIMESTAMP NOT NULL DEFAULT now()`,
    );

    await queryRunner.query(`
      CREATE TABLE "escalation_timeline_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "escalation_id" uuid,
        "request_id" character varying(64) NOT NULL,
        "event_type" character varying(64) NOT NULL,
        "level" integer,
        "target_role" character varying(64),
        "action" character varying(32),
        "outcome" character varying(32),
        "metadata" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_escalation_timeline_events_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_escalation_timeline_request" ON "escalation_timeline_events" ("request_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_escalation_timeline_escalation" ON "escalation_timeline_events" ("escalation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_escalation_timeline_created" ON "escalation_timeline_events" ("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_escalation_timeline_created"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_escalation_timeline_escalation"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_escalation_timeline_request"`,
    );
    await queryRunner.query(`DROP TABLE "escalation_timeline_events"`);

    await queryRunner.query(`ALTER TABLE "escalations" DROP COLUMN "updated_at"`);
    await queryRunner.query(
      `ALTER TABLE "escalations" DROP COLUMN "remediation_task_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "escalations" DROP COLUMN "incident_review_id"`,
    );
    await queryRunner.query(`ALTER TABLE "escalations" DROP COLUMN "status"`);
    await queryRunner.query(
      `ALTER TABLE "escalations" DROP COLUMN "next_escalation_at"`,
    );
    await queryRunner.query(`ALTER TABLE "escalations" DROP COLUMN "current_level"`);
    await queryRunner.query(`ALTER TABLE "escalations" DROP COLUMN "policy_chain"`);
  }
}
