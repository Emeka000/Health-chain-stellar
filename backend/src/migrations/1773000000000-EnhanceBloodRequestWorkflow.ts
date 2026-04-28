import { TableColumn, TableIndex, Table, TableForeignKey } from 'typeorm';

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnhanceBloodRequestWorkflow1773000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns to blood_requests table
    const newColumns = [
      new TableColumn({
        name: 'urgency_level',
        type: 'varchar',
        length: '24',
        default: `'ROUTINE'`,
        isNullable: false,
      }),
      new TableColumn({
        name: 'delivery_contact_name',
        type: 'varchar',
        length: '120',
        isNullable: true,
      }),
      new TableColumn({
        name: 'delivery_contact_phone',
        type: 'varchar',
        length: '32',
        isNullable: true,
      }),
      new TableColumn({
        name: 'delivery_instructions',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'delivery_window_start',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'delivery_window_end',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'matched_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'approved_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'fulfilled_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'cancelled_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'rejected_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'status_updated_at',
        type: 'timestamptz',
        default: 'CURRENT_TIMESTAMP',
        isNullable: false,
      }),
      new TableColumn({
        name: 'sla_response_due_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'sla_fulfillment_due_at',
        type: 'timestamptz',
        isNullable: true,
      }),
      new TableColumn({
        name: 'blockchain_request_id',
        type: 'varchar',
        length: '128',
        isNullable: true,
      }),
      new TableColumn({
        name: 'blockchain_network',
        type: 'varchar',
        length: '64',
        isNullable: true,
      }),
      new TableColumn({
        name: 'blockchain_confirmed_at',
        type: 'timestamptz',
        isNullable: true,
      }),
    ];

    for (const column of newColumns) {
      await queryRunner.addColumn('blood_requests', column);
    }

    // Update status enum to include new values
    // PostgreSQL doesn't support direct enum modification, so we'll just ensure the column accepts wider values
    await queryRunner.changeColumn(
      'blood_requests',
      'status',
      new TableColumn({
        name: 'status',
        type: 'varchar',
        length: '32',
        default: `'PENDING'`,
        isNullable: false,
      }),
    );

    // Add indexes to blood_requests
    const newIndexes = [
      new TableIndex({
        name: 'IDX_BLOOD_REQUESTS_HOSPITAL_ID',
        columnNames: ['hospital_id'],
      }),
      new TableIndex({
        name: 'IDX_BLOOD_REQUESTS_STATUS',
        columnNames: ['status'],
      }),
      new TableIndex({
        name: 'IDX_BLOOD_REQUESTS_URGENCY_LEVEL',
        columnNames: ['urgency_level'],
      }),
      new TableIndex({
        name: 'IDX_BLOOD_REQUESTS_REQUIRED_BY',
        columnNames: ['required_by'],
      }),
    ];

    for (const index of newIndexes) {
      const table = await queryRunner.getTable('blood_requests');
      const indexExists = table?.indices.some(
        (entry) => entry.name === index.name,
      );
      if (!indexExists) {
        await queryRunner.createIndex('blood_requests', index);
      }
    }

    // Add fulfilled_quantity column to blood_request_items
    await queryRunner.addColumn(
      'blood_request_items',
      new TableColumn({
        name: 'fulfilled_quantity',
        type: 'int',
        default: 0,
        isNullable: false,
      }),
    );

    // Add indexes to blood_request_items
    const itemIndexes = [
      new TableIndex({
        name: 'IDX_BLOOD_REQUEST_ITEMS_BLOOD_TYPE',
        columnNames: ['blood_type'],
      }),
    ];

    for (const index of itemIndexes) {
      const table = await queryRunner.getTable('blood_request_items');
      const indexExists = table?.indices.some(
        (entry) => entry.name === index.name,
      );
      if (!indexExists) {
        await queryRunner.createIndex('blood_request_items', index);
      }
    }

    // Create request_status_history table
    await queryRunner.createTable(
      new Table({
        name: 'request_status_history',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'request_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'previous_status',
            type: 'varchar',
            length: '32',
            isNullable: true,
          },
          {
            name: 'new_status',
            type: 'varchar',
            length: '32',
            isNullable: false,
          },
          {
            name: 'reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'changed_by_user_id',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Add foreign key for request_id
    await queryRunner.createForeignKey(
      'request_status_history',
      new TableForeignKey({
        name: 'FK_REQUEST_STATUS_HISTORY_REQUEST',
        columnNames: ['request_id'],
        referencedTableName: 'blood_requests',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    // Add indexes to request_status_history
    const historyIndexes = [
      new TableIndex({
        name: 'IDX_REQUEST_STATUS_HISTORY_REQUEST_ID',
        columnNames: ['request_id'],
      }),
      new TableIndex({
        name: 'IDX_REQUEST_STATUS_HISTORY_CREATED_AT',
        columnNames: ['created_at'],
      }),
    ];

    for (const index of historyIndexes) {
      await queryRunner.createIndex('request_status_history', index);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop request_status_history table
    await queryRunner.dropTable('request_status_history', true);

    // Drop indexes from blood_request_items
    const itemIndexNames = ['IDX_BLOOD_REQUEST_ITEMS_BLOOD_TYPE'];

    for (const indexName of itemIndexNames) {
      const table = await queryRunner.getTable('blood_request_items');
      const indexExists = table?.indices.some(
        (entry) => entry.name === indexName,
      );
      if (indexExists) {
        await queryRunner.dropIndex('blood_request_items', indexName);
      }
    }

    // Drop fulfilled_quantity column
    await queryRunner.dropColumn('blood_request_items', 'fulfilled_quantity');

    // Drop indexes from blood_requests
    const indexNames = [
      'IDX_BLOOD_REQUESTS_HOSPITAL_ID',
      'IDX_BLOOD_REQUESTS_STATUS',
      'IDX_BLOOD_REQUESTS_URGENCY_LEVEL',
      'IDX_BLOOD_REQUESTS_REQUIRED_BY',
    ];

    for (const indexName of indexNames) {
      const table = await queryRunner.getTable('blood_requests');
      const indexExists = table?.indices.some(
        (entry) => entry.name === indexName,
      );
      if (indexExists) {
        await queryRunner.dropIndex('blood_requests', indexName);
      }
    }

    // Drop new columns from blood_requests (reverse order)
    const columnsToRemove = [
      'urgency_level',
      'delivery_contact_name',
      'delivery_contact_phone',
      'delivery_instructions',
      'delivery_window_start',
      'delivery_window_end',
      'matched_at',
      'approved_at',
      'fulfilled_at',
      'cancelled_at',
      'rejected_at',
      'status_updated_at',
      'sla_response_due_at',
      'sla_fulfillment_due_at',
      'blockchain_request_id',
      'blockchain_network',
      'blockchain_confirmed_at',
    ];

    for (const columnName of columnsToRemove) {
      await queryRunner.dropColumn('blood_requests', columnName);
    }

    // Revert status column back to smaller size
    await queryRunner.changeColumn(
      'blood_requests',
      'status',
      new TableColumn({
        name: 'status',
        type: 'varchar',
        length: '24',
        default: `'PENDING'`,
        isNullable: false,
      }),
    );
  }
}
