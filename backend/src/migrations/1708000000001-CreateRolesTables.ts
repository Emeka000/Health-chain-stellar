import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateRolesTables1708000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── roles ──────────────────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'roles',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            length: '50',
            isUnique: true,
          },
          {
            name: 'description',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    // ── role_permissions ───────────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'role_permissions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'role_id',
            type: 'uuid',
          },
          {
            name: 'permission',
            type: 'varchar',
            length: '100',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['role_id'],
            referencedTableName: 'roles',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'role_permissions',
      new TableIndex({
        name: 'idx_role_permissions_role_id',
        columnNames: ['role_id'],
      }),
    );

    await queryRunner.createIndex(
      'role_permissions',
      new TableIndex({
        name: 'idx_role_permissions_unique',
        columnNames: ['role_id', 'permission'],
        isUnique: true,
      }),
    );

    // ── Seed default roles ─────────────────────────────────────────────────
    const roles = [
      { name: 'ADMIN', description: 'System administrator with full access' },
      { name: 'HOSPITAL', description: 'Hospital staff managing blood orders' },
      { name: 'RIDER', description: 'Dispatch rider handling deliveries' },
      { name: 'DONOR', description: 'Blood donor with read-only access' },
      { name: 'VENDOR', description: 'Vendor managing blood unit supply' },
    ];

    for (const role of roles) {
      await queryRunner.query(
        `INSERT INTO roles (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
        [role.name, role.description],
      );
    }

    // ── Seed ADMIN permissions ─────────────────────────────────────────────
    const adminPermissions = [
      'CREATE_ORDER', 'READ_ORDER', 'UPDATE_ORDER', 'CANCEL_ORDER',
      'CREATE_HOSPITAL', 'READ_HOSPITAL', 'UPDATE_HOSPITAL', 'DELETE_HOSPITAL',
      'CREATE_RIDER', 'READ_RIDER', 'UPDATE_RIDER', 'DELETE_RIDER', 'MANAGE_RIDERS',
      'CREATE_INVENTORY', 'READ_INVENTORY', 'UPDATE_INVENTORY', 'DELETE_INVENTORY',
      'REGISTER_BLOOD_UNIT', 'TRANSFER_BLOOD_CUSTODY', 'VIEW_BLOODUNIT_TRAIL',
      'CREATE_USER', 'READ_USER', 'UPDATE_USER', 'DELETE_USER', 'MANAGE_USERS',
      'CREATE_DISPATCH', 'READ_DISPATCH', 'UPDATE_DISPATCH', 'ASSIGN_DISPATCH',
      'MANAGE_ROLES', 'VIEW_ANALYTICS', 'MANAGE_SYSTEM',
    ];

    for (const perm of adminPermissions) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $1 FROM roles WHERE name = 'ADMIN'
         ON CONFLICT DO NOTHING`,
        [perm],
      );
    }

    // ── Seed HOSPITAL permissions ──────────────────────────────────────────
    const hospitalPermissions = [
      'CREATE_ORDER', 'READ_ORDER', 'UPDATE_ORDER', 'CANCEL_ORDER',
      'READ_HOSPITAL', 'READ_INVENTORY', 'VIEW_BLOODUNIT_TRAIL', 'READ_USER',
    ];
    for (const perm of hospitalPermissions) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $1 FROM roles WHERE name = 'HOSPITAL'
         ON CONFLICT DO NOTHING`,
        [perm],
      );
    }

    // ── Seed RIDER permissions ─────────────────────────────────────────────
    const riderPermissions = [
      'READ_ORDER', 'UPDATE_ORDER', 'READ_DISPATCH', 'UPDATE_DISPATCH',
      'VIEW_BLOODUNIT_TRAIL', 'TRANSFER_BLOOD_CUSTODY',
    ];
    for (const perm of riderPermissions) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $1 FROM roles WHERE name = 'RIDER'
         ON CONFLICT DO NOTHING`,
        [perm],
      );
    }

    // ── Seed DONOR permissions ─────────────────────────────────────────────
    const donorPermissions = ['READ_ORDER', 'READ_HOSPITAL', 'VIEW_BLOODUNIT_TRAIL'];
    for (const perm of donorPermissions) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $1 FROM roles WHERE name = 'DONOR'
         ON CONFLICT DO NOTHING`,
        [perm],
      );
    }

    // ── Seed VENDOR permissions ────────────────────────────────────────────
    const vendorPermissions = [
      'REGISTER_BLOOD_UNIT', 'TRANSFER_BLOOD_CUSTODY', 'VIEW_BLOODUNIT_TRAIL',
      'READ_INVENTORY', 'UPDATE_INVENTORY',
    ];
    for (const perm of vendorPermissions) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $1 FROM roles WHERE name = 'VENDOR'
         ON CONFLICT DO NOTHING`,
        [perm],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('role_permissions', true);
    await queryRunner.dropTable('roles', true);
  }
}
