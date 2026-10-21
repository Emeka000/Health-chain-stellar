import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFeePolicyEffectiveFromDefault1850000000000 implements MigrationInterface {
  name = 'AddFeePolicyEffectiveFromDefault1850000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fee_policies" ALTER COLUMN "effective_from" SET DEFAULT CURRENT_TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "fee_policies" ALTER COLUMN "effective_from" SET NOT NULL`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_policy_match"`);
    await queryRunner.query(
      `CREATE INDEX "idx_policy_match" ON "fee_policies" ("geography_code", "urgency_tier", "service_level", "min_distance_km", "max_distance_km", "effective_from", "effective_to")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_policy_match"`);
    await queryRunner.query(
      `CREATE INDEX "idx_policy_match" ON "fee_policies" ("geography_code", "urgency_tier", "service_level", "min_distance_km", "max_distance_km", "effective_from")`,
    );

    await queryRunner.query(
      `ALTER TABLE "fee_policies" ALTER COLUMN "effective_from" DROP DEFAULT`,
    );
  }
}