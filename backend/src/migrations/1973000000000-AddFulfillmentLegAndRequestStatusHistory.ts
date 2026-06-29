import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class AddFulfillmentLegAndRequestStatusHistory1973000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'fulfillment_legs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'parent_request_id',
            type: 'varchar',
            length: '64',
          },
          {
            name: 'leg_number',
            type: 'int',
          },
          {
            name: 'blood_bank_id',
            type: 'varchar',
            length: '64',
          },
          {
            name: 'blood_bank_name',
            type: 'varchar',
            length: '255',
          },
          {
            name: 'allocated_units',
            type: 'text',
          },
          {
            name: 'quantity_ml',
            type: 'int',
          },
          {
            name: 'rider_id',
            type: 'varchar',
            length: '64',
            isNullable: true,
          },
          {
            name: 'rider_name',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '24',
            default: `'PENDING'`,
          },
          {
            name: 'estimated_delivery_time',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'actual_delivery_time',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'pickup_location',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'delivery_location',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'failure_reason',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'now()',
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
      true,
    );

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
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    // Add foreign keys and indexes
    await queryRunner.createForeignKey(
      'fulfillment_legs',
      new TableForeignKey({
        name: 'FK_fulfillment_legs_parent_request',
        columnNames: ['parent_request_id'],
        referencedTableName: 'blood_requests',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'fulfillment_legs',
      new TableIndex({
        name: 'idx_fulfillment_legs_parent_request',
        columnNames: ['parent_request_id'],
      }),
    );

    await queryRunner.createIndex(
      'fulfillment_legs',
      new TableIndex({
        name: 'idx_fulfillment_legs_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'fulfillment_legs',
      new TableIndex({
        name: 'idx_fulfillment_legs_blood_bank',
        columnNames: ['blood_bank_id'],
      }),
    );

    await queryRunner.createIndex(
      'fulfillment_legs',
      new TableIndex({
        name: 'idx_fulfillment_legs_rider',
        columnNames: ['rider_id'],
      }),
    );

    await queryRunner.createForeignKey(
      'request_status_history',
      new TableForeignKey({
        name: 'FK_request_status_history_request',
        columnNames: ['request_id'],
        referencedTableName: 'blood_requests',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createIndex(
      'request_status_history',
      new TableIndex({
        name: 'IDX_REQUEST_STATUS_HISTORY_REQUEST_ID',
        columnNames: ['request_id'],
      }),
    );

    await queryRunner.createIndex(
      'request_status_history',
      new TableIndex({
        name: 'IDX_REQUEST_STATUS_HISTORY_CREATED_AT',
        columnNames: ['created_at'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey(
      'request_status_history',
      'FK_request_status_history_request',
    );
    await queryRunner.dropIndex(
      'request_status_history',
      'IDX_REQUEST_STATUS_HISTORY_CREATED_AT',
    );
    await queryRunner.dropIndex(
      'request_status_history',
      'IDX_REQUEST_STATUS_HISTORY_REQUEST_ID',
    );
    await queryRunner.dropTable('request_status_history', true);

    await queryRunner.dropForeignKey(
      'fulfillment_legs',
      'FK_fulfillment_legs_parent_request',
    );
    await queryRunner.dropIndex(
      'fulfillment_legs',
      'idx_fulfillment_legs_rider',
    );
    await queryRunner.dropIndex(
      'fulfillment_legs',
      'idx_fulfillment_legs_blood_bank',
    );
    await queryRunner.dropIndex(
      'fulfillment_legs',
      'idx_fulfillment_legs_status',
    );
    await queryRunner.dropIndex(
      'fulfillment_legs',
      'idx_fulfillment_legs_parent_request',
    );
    await queryRunner.dropTable('fulfillment_legs', true);
  }
}
