import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateAuditLogsTable1830000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'audit_logs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'actor_id', type: 'varchar', length: '64' },
          { name: 'actor_role', type: 'varchar', length: '64' },
          { name: 'action', type: 'varchar', length: '128' },
          { name: 'resource_type', type: 'varchar', length: '64' },
          { name: 'resource_id', type: 'varchar', length: '64' },
          { name: 'previous_value', type: 'jsonb', isNullable: true },
          { name: 'next_value', type: 'jsonb', isNullable: true },
          { name: 'ip_address', type: 'varchar', length: '64', isNullable: true },
          { name: 'timestamp', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({ name: 'idx_audit_logs_actor', columnNames: ['actor_id'] }),
    );
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_resource',
        columnNames: ['resource_type', 'resource_id'],
      }),
    );
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({ name: 'idx_audit_logs_timestamp', columnNames: ['timestamp'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('audit_logs', true);
  }
}
