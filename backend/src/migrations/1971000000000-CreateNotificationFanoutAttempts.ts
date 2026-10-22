import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationFanoutAttempts1971000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_fanout_attempts" (
        "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        "idempotency_key"  VARCHAR(255) NOT NULL,
        "user_id"          VARCHAR(255) NOT NULL,
        "category"         VARCHAR(64) NOT NULL,
        "emergency_tier"   VARCHAR(32) NOT NULL DEFAULT 'normal',
        "channel_count"    INTEGER NOT NULL DEFAULT 0,
        "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_fanout_idempotency_key" UNIQUE ("idempotency_key")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fanout_attempts_user_id"
        ON "notification_fanout_attempts" ("user_id")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_fanout_attempts"`);
  }
}
