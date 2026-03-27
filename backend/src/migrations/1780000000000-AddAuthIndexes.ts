import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthIndexes1780000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Index for email lookups (already exists but ensure it's unique)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_USERS_EMAIL_AUTH" ON "users" ("email") WHERE "deleted_at" IS NULL`,
    );

    // Index for lockout field queries
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_USERS_LOCKED_UNTIL" ON "users" ("locked_until") WHERE "locked_until" IS NOT NULL`,
    );

    // Index for failed login attempts
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_USERS_FAILED_LOGIN_ATTEMPTS" ON "users" ("failed_login_attempts") WHERE "failed_login_attempts" > 0`,
    );

    // Index for active users (common filter)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_USERS_IS_ACTIVE" ON "users" ("is_active")`,
    );

    // Composite index for session lookups (email + active status)
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_USERS_EMAIL_ACTIVE" ON "users" ("email", "is_active") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_USERS_EMAIL_AUTH"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_USERS_LOCKED_UNTIL"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_USERS_FAILED_LOGIN_ATTEMPTS"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_USERS_IS_ACTIVE"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_USERS_EMAIL_ACTIVE"`);
  }
}
