import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLocationToBloodUnits1820000000000 implements MigrationInterface {
    name = 'AddLocationToBloodUnits1820000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Enable PostGIS if not already enabled
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS postgis`);

        // 2. Add latitude and longitude columns
        await queryRunner.query(`ALTER TABLE "blood_units" ADD "latitude" double precision`);
        await queryRunner.query(`ALTER TABLE "blood_units" ADD "longitude" double precision`);

        // 3. Add geography column for spatial queries
        await queryRunner.query(`ALTER TABLE "blood_units" ADD "location" geography(Point, 4326)`);

        // 4. Create a GIST index for the location column
        await queryRunner.query(`CREATE INDEX "idx_blood_units_location" ON "blood_units" USING GIST ("location")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "idx_blood_units_location"`);
        await queryRunner.query(`ALTER TABLE "blood_units" DROP COLUMN "location"`);
        await queryRunner.query(`ALTER TABLE "blood_units" DROP COLUMN "longitude"`);
        await queryRunner.query(`ALTER TABLE "blood_units" DROP COLUMN "latitude"`);
    }

}
