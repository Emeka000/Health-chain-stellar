import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the RBAC tables (roles, permissions, role_permissions, user_roles)
 * and seeds the default roles and permission grants.
 */
export class CreateRbacTables1708000001000 implements MigrationInterface {
  name = 'CreateRbacTables1708000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "description" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roles_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_roles_name" UNIQUE ("name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "description" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_permissions_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_permissions_name" UNIQUE ("name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "role_permissions" (
        "role_id" uuid NOT NULL,
        "permission_id" uuid NOT NULL,
        CONSTRAINT "PK_role_permissions" PRIMARY KEY ("role_id", "permission_id"),
        CONSTRAINT "FK_role_permissions_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_role_permissions_permission" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_roles" (
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        CONSTRAINT "PK_user_roles" PRIMARY KEY ("user_id", "role_id"),
        CONSTRAINT "FK_user_roles_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE
      )
    `);

    const roles: Array<{ name: string; description: string }> = [
      { name: 'rider', description: 'End user who requests and receives deliveries' },
      { name: 'driver', description: 'Courier who fulfils deliveries' },
      { name: 'dispatcher', description: 'Operations staff who manage dispatch' },
      { name: 'admin', description: 'Platform administrator' },
    ];

    for (const role of roles) {
      await queryRunner.query(
        `INSERT INTO "roles" ("name", "description") VALUES ($1, $2) ON CONFLICT ("name") DO NOTHING`,
        [role.name, role.description],
      );
    }

    const permissions: Array<{ name: string; description: string }> = [
      { name: 'manage:dispatch', description: 'Manage dispatch operations' },
      { name: 'dispatch:override', description: 'Override dispatch decisions' },
      { name: 'manage:deliveries', description: 'Manage deliveries' },
      { name: 'manage:users', description: 'Manage users' },
      { name: 'manage:payments', description: 'Manage payments' },
      { name: 'view:analytics', description: 'View analytics' },
    ];

    for (const permission of permissions) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("name", "description") VALUES ($1, $2) ON CONFLICT ("name") DO NOTHING`,
        [permission.name, permission.description],
      );
    }

    // Role -> permission grants.
    //
    // NOTE: `manage:dispatch` and `dispatch:override` are intentionally NOT
    // granted to the `rider` role. Riders must not be able to acknowledge,
    // resolve, or downgrade their own route-deviation incidents (see #1533).
    // These permissions are reserved for dispatchers and admins.
    const rolePermissions: Record<string, string[]> = {
      rider: ['manage:deliveries'],
      driver: ['manage:deliveries'],
      dispatcher: ['manage:dispatch', 'dispatch:override', 'manage:deliveries', 'view:analytics'],
      admin: [
        'manage:dispatch',
        'dispatch:override',
        'manage:deliveries',
        'manage:users',
        'manage:payments',
        'view:analytics',
      ],
    };

    for (const [roleName, permissionNames] of Object.entries(rolePermissions)) {
      for (const permissionName of permissionNames) {
        await queryRunner.query(
          `INSERT INTO "role_permissions" ("role_id", "permission_id")
           SELECT r."id", p."id" FROM "roles" r, "permissions" p
           WHERE r."name" = $1 AND p."name" = $2
           ON CONFLICT DO NOTHING`,
          [roleName, permissionName],
        );
      }
    }

    // Rider: dispatch, orders, location updates.
    // NOTE: riders must NOT hold `manage:dispatch` or `dispatch:override`.
    // Those permissions let a rider accept/reject assignments on behalf of
    // other riders or force-assign any order to themselves (see #1538).
    const riderPermissions = [
      'view:order',
      'update:order',
      'view:dispatch',
      'update:dispatch',
      'view:riders',
      'update:rider',
      'view:maps',
      'view:bloodunit:trail',
      'transfer:custody',
      'log:temperature',
      'view:notifications',
    ];

    for (const permission of riderPermissions) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $1 FROM roles WHERE name = 'rider'
         ON CONFLICT DO NOTHING`,
        [permission],
      );
    }

    // Vendor: inventory management, blood unit registration
    const vendorPermissions = [
      'view:inventory',
      'create:inventory',
      'update:inventory',
      'view:bloodunit:trail',
      'register:bloodunit',
      'transfer:custody',
      'log:temperature',
      'view:order',
      'view:notifications',
    ];

    for (const permission of vendorPermissions) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $1 FROM roles WHERE name = 'vendor'
         ON CONFLICT DO NOTHING`,
        [permission],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
  }
}
