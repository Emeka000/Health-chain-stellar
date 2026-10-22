import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateOnChainTxStatesTable1920000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'on_chain_tx_states',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'transaction_hash',
            type: 'varchar',
            length: '128',
            isUnique: true,
          },
          {
            name: 'contract_method',
            type: 'varchar',
            length: '128',
          },
          {
            name: 'idempotency_key',
            type: 'varchar',
            length: '128',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            default: "'pending'",
          },
          {
            name: 'confirmations',
            type: 'int',
            default: 0,
          },
          {
            name: 'finality_threshold',
            type: 'int',
            default: 1,
          },
          {
            name: 'emitted_events',
            type: 'int',
            default: 0,
          },
          {
            name: 'failure_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
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
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'on_chain_tx_states',
      new TableIndex({
        name: 'IDX_ON_CHAIN_TX_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'on_chain_tx_states',
      new TableIndex({
        name: 'IDX_ON_CHAIN_TX_CONTRACT_METHOD',
        columnNames: ['contract_method'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('on_chain_tx_states');
  }
}
