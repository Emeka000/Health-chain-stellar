import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateAuditChainTables1940000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'audit_chain_entries',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'audit_log_id', type: 'uuid' },
          { name: 'sequence', type: 'bigint' },
          { name: 'entry_hash', type: 'varchar', length: '64' },
          { name: 'previous_hash', type: 'varchar', length: '64' },
          { name: 'chained_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'audit_chain_entries',
      new TableIndex({
        name: 'idx_ace_sequence',
        columnNames: ['sequence'],
        isUnique: true,
      }),
    );
    await queryRunner.createIndex(
      'audit_chain_entries',
      new TableIndex({ name: 'idx_ace_audit_log', columnNames: ['audit_log_id'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'audit_chain_checkpoints',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'up_to_sequence', type: 'bigint' },
          { name: 'root_hash', type: 'varchar', length: '64' },
          { name: 'external_ref', type: 'varchar', length: '512', isNullable: true },
          { name: 'anchored_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'audit_chain_checkpoints',
      new TableIndex({ name: 'idx_acc_sequence', columnNames: ['up_to_sequence'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('audit_chain_checkpoints', true);
    await queryRunner.dropTable('audit_chain_entries', true);
  }
}
