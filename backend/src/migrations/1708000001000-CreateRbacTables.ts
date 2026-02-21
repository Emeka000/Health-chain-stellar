import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class CreateRbacTables1708000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── roles ──────────────────────────────────────────────────────────
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
            isNullable: false,
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

    await queryRunner.createIndex(
      'roles',
      new TableIndex({
        name: 'IDX_roles_name',
        columnNames: ['name'],
        isUnique: true,
      }),
    );

    // ── role_permissions ───────────────────────────────────────────────
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
            isNullable: false,
          },
          {
            name: 'permission',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'role_permissions',
      new TableIndex({
        name: 'IDX_role_permissions_role_permission',
        columnNames: ['role_id', 'permission'],
        isUnique: true,
      }),
    );

    await queryRunner.createForeignKey(
      'role_permissions',
      new TableForeignKey({
        name: 'FK_role_permissions_role',
        columnNames: ['role_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'roles',
        onDelete: 'CASCADE',
      }),
    );

    // ── seed default role-permission mappings ──────────────────────────
    const roles = [
      { name: 'admin', description: 'Full platform access' },
      { name: 'hospital', description: 'Hospital staff' },
      { name: 'donor', description: 'Blood donor' },
      { name: 'rider', description: 'Delivery rider' },
      { name: 'vendor', description: 'Blood bank / vendor' },
    ];

    for (const role of roles) {
      await queryRunner.query(
        `INSERT INTO roles (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
        [role.name, role.description],
      );
    }

    // Admin gets every permission
    const adminPermissions = [
      'create:order', 'view:order', 'update:order', 'cancel:order', 'delete:order',
      'view:riders', 'create:rider', 'update:rider', 'delete:rider', 'manage:riders',
      'view:hospitals', 'create:hospital', 'update:hospital', 'delete:hospital',
      'view:inventory', 'create:inventory', 'update:inventory', 'delete:inventory',
      'view:bloodunit:trail', 'register:bloodunit', 'transfer:custody', 'log:temperature',
      'view:dispatch', 'create:dispatch', 'update:dispatch', 'delete:dispatch', 'manage:dispatch',
      'view:users', 'manage:users', 'delete:user',
      'view:notifications', 'manage:notifications',
      'view:maps',
      'manage:soroban', 'view:blockchain',
      'admin:access', 'manage:roles',
    ];

    for (const permission of adminPermissions) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $1 FROM roles WHERE name = 'admin'
         ON CONFLICT DO NOTHING`,
        [permission],
      );
    }

    // Hospital: order management, inventory, blood units, notifications, maps
    const hospitalPermissions = [
      'create:order', 'view:order', 'cancel:order',
      'view:inventory',
      'view:bloodunit:trail', 'register:bloodunit',
      'view:notifications',
      'view:maps',
      'view:hospitals',
    ];

    for (const permission of hospitalPermissions) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $1 FROM roles WHERE name = 'hospital'
         ON CONFLICT DO NOTHING`,
        [permission],
      );
    }

    // Donor: limited order viewing
    const donorPermissions = [
      'create:order', 'view:order', 'cancel:order',
      'view:notifications',
    ];

    for (const permission of donorPermissions) {
      await queryRunner.query(
        `INSERT INTO role_permissions (role_id, permission)
         SELECT id, $1 FROM roles WHERE name = 'donor'
         ON CONFLICT DO NOTHING`,
        [permission],
      );
    }

    // Rider: dispatch, orders, location updates
    const riderPermissions = [
      'view:order', 'update:order',
      'view:dispatch', 'update:dispatch', 'manage:dispatch',
      'view:riders', 'update:rider',
      'view:maps',
      'view:bloodunit:trail', 'transfer:custody', 'log:temperature',
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
      'view:inventory', 'create:inventory', 'update:inventory',
      'view:bloodunit:trail', 'register:bloodunit', 'transfer:custody', 'log:temperature',
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
    await queryRunner.dropForeignKey(
      'role_permissions',
      'FK_role_permissions_role',
    );
    await queryRunner.dropTable('role_permissions', true);
    await queryRunner.dropTable('roles', true);
  }
}
