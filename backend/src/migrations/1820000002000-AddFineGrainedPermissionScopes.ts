import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFineGrainedPermissionScopes1820000002000 implements MigrationInterface {
  name = 'AddFineGrainedPermissionScopes1820000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add fine-grained permission scopes to existing roles.
    //
    // NOTE: riders must NOT hold dispatch:override or manage:dispatch. Those
    // scopes let a rider force-assign any order to themselves or accept/reject
    // assignments on behalf of other riders. Rider-facing dispatch actions are
    // authorized by the assignment service checking the authenticated rider
    // against the current candidate, not by these broad scopes.
    await queryRunner.query(`
      INSERT INTO "permissions" ("name", "description")
      VALUES
        ('dispatch:override', 'Override dispatch assignments'),
        ('manage:dispatch', 'Manage dispatch operations')
      ON CONFLICT ("name") DO NOTHING
    `);

    // Grant the fine-grained scopes to admin/dispatcher roles only.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId")
      SELECT r."id", p."id"
      FROM "roles" r
      CROSS JOIN "permissions" p
      WHERE r."name" IN ('admin', 'dispatcher')
        AND p."name" IN ('dispatch:override', 'manage:dispatch')
      ON CONFLICT DO NOTHING
    `);

    // Ensure riders never hold these broad dispatch scopes.
    await queryRunner.query(`
      DELETE FROM "role_permissions" rp
      USING "roles" r, "permissions" p
      WHERE rp."roleId" = r."id"
        AND rp."permissionId" = p."id"
        AND r."name" = 'rider'
        AND p."name" IN ('dispatch:override', 'manage:dispatch')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the previous (over-broad) rider grants on rollback.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("roleId", "permissionId")
      SELECT r."id", p."id"
      FROM "roles" r
      CROSS JOIN "permissions" p
      WHERE r."name" = 'rider'
        AND p."name" IN ('dispatch:override', 'manage:dispatch')
      ON CONFLICT DO NOTHING
    `);
  }
}
