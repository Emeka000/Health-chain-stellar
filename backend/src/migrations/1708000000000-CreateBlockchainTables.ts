import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateBlockchainTables1708000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create blockchain_events table
    await queryRunner.createTable(
      new Table({
        name: 'blockchain_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'event_type',
            type: 'varchar',
            length: '100',
          },
          {
            name: 'transaction_hash',
            type: 'varchar',
            length: '255',
            isUnique: true,
          },
          {
            name: 'event_data',
            type: 'jsonb',
          },
          {
            name: 'blockchain_timestamp',
            type: 'timestamp',
          },
          {
            name: 'indexed_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'processed',
            type: 'boolean',
            default: false,
          },
        ],
      }),
      true,
    );

    // Create indexes for blockchain_events
    await queryRunner.createIndex(
      'blockchain_events',
      new TableIndex({
        name: 'IDX_blockchain_events_type_timestamp',
        columnNames: ['event_type', 'blockchain_timestamp'],
      }),
    );

    // Create blood_unit_trails table
    await queryRunner.createTable(
      new Table({
        name: 'blood_unit_trails',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'unit_id',
            type: 'bigint',
          },
          {
            name: 'custody_trail',
            type: 'jsonb',
          },
          {
            name: 'temperature_logs',
            type: 'jsonb',
          },
          {
            name: 'status_history',
            type: 'jsonb',
          },
          {
            name: 'last_updated',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'last_synced_at',
            type: 'timestamp',
            isNullable: true,
          },
        ],
      }),
      true,
    );

    // Create index for blood_unit_trails
    await queryRunner.createIndex(
      'blood_unit_trails',
      new TableIndex({
        name: 'IDX_blood_unit_trails_unit_id',
        columnNames: ['unit_id'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('blood_unit_trails');
    await queryRunner.dropTable('blockchain_events');
  }
}
