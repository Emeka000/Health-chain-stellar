import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransparencyPublications1976000000000
  implements MigrationInterface
{
  name = 'CreateTransparencyPublications1976000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "transparency_publications" (
        "period" DATE PRIMARY KEY,
        "artifact" JSONB NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "transparency_publications"`,
    );
  }
}