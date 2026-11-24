import { MigrationInterface, QueryRunner } from 'typeorm';

const RIDER_PERMISSIONS = [
  'ride:request',
  'ride:view_own',
  'ride:cancel_own',
  'profile:view_own',
  'profile:update_own',
];

const VENDOR_PERMISSIONS = [
  'ride:view_assigned',
  'ride:accept',
  'ride:complete',
  'profile:view_own',
  'profile:update_own',
];

export class CreateRbacTables1708000001000 implements MigrationInterface {
  name = 'CreateRbacTables1708000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(64) NOT NULL,
        "description" character varying(255),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roles_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_roles_name" UNIQUE ("name")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(128) NOT NULL,
        "description" character varying(255),
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
        CONSTRAINT "FK_role_permissions_role_id" FOREIGN KEY ("role_id")
          REFERENCES "roles" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_role_permissions_permission_id" FOREIGN KEY ("permission_id")
          REFERENCES "permissions" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_roles" (
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        CONSTRAINT "PK_user_roles" PRIMARY KEY ("user_id", "role_id"),
        CONSTRAINT "FK_user_roles_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_roles_role_id" FOREIGN KEY ("role_id")
          REFERENCES "roles" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      INSERT INTO "roles" ("name", "description") VALUES
        ('rider', 'Rider who requests rides'),
        ('vendor', 'Vendor who fulfills rides'),
        ('admin', 'Platform administrator')
      ON CONFLICT ("name") DO NOTHING
    `);

    await queryRunner.query(`
      INSERT INTO "permissions" ("name", "description") VALUES
        ('ride:request', 'Request a ride'),
        ('ride:view_own', 'View own rides'),
        ('ride:cancel_own', 'Cancel own rides'),
        ('ride:view_assigned', 'View rides assigned to the vendor'),
        ('ride:accept', 'Accept an assigned ride'),
        ('ride:complete', 'Complete an assigned ride'),
        ('profile:view_own', 'View own profile'),
        ('profile:update_own', 'Update own profile'),
        ('admin:manage_users', 'Manage users'),
        ('admin:manage_roles', 'Manage roles and permissions')
      ON CONFLICT ("name") DO NOTHING
    `);

    for (const permission of RIDER_PERMISSIONS) {
      await queryRunner.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
         SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
         WHERE r."name" = 'rider' AND p."name" = $1
         ON CONFLICT DO NOTHING`,
        [permission],
      );
    }

    for (const permission of VENDOR_PERMISSIONS) {
      await queryRunner.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
         SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
         WHERE r."name" = 'vendor' AND p."name" = $1
         ON CONFLICT DO NOTHING`,
        [permission],
      );
    }

    await queryRunner.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id")
       SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
       WHERE r."name" = 'admin' AND p."name" IN ('admin:manage_users', 'admin:manage_roles')
       ON CONFLICT DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "role_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roles"`);
  }
}