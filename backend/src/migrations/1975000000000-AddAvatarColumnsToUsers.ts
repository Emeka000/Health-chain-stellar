import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAvatarColumnsToUsers1975000000000 implements MigrationInterface {
  name = 'AddAvatarColumnsToUsers1975000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "avatar_url" varchar(2048),
      ADD COLUMN IF NOT EXISTS "avatar_key" varchar(512)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "avatar_url",
      DROP COLUMN IF EXISTS "avatar_key"
    `);
  }
}
