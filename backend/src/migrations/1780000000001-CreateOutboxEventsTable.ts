import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateOutboxEventsTable1780000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'outbox_events',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          {
            name: 'event_type',
            type: 'varchar',
            length: '100',
            isNullable: false,
          },
          {
            name: 'payload',
            type: 'jsonb',
            isNullable: false,
          },
          {
            name: 'aggregate_id',
            type: 'varchar',
            length: '255',
            isNullable: true,
          },
          {
            name: 'aggregate_type',
            type: 'varchar',
            length: '100',
            isNullable: true,
          },
          {
            name: 'published',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'published_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'retry_count',
            type: 'int',
            default: 0,
            isNullable: false,
          },
          {
            name: 'error',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Create indexes
    await queryRunner.createIndex(
      'outbox_events',
      new TableIndex({
        name: 'IDX_OUTBOX_PUBLISHED',
        columnNames: ['published'],
      }),
    );

    await queryRunner.createIndex(
      'outbox_events',
      new TableIndex({
        name: 'IDX_OUTBOX_EVENT_TYPE',
        columnNames: ['event_type'],
      }),
    );

    await queryRunner.createIndex(
      'outbox_events',
      new TableIndex({
        name: 'IDX_OUTBOX_CREATED_AT',
        columnNames: ['created_at'],
      }),
    );

    // Partial index for unpublished events
    await queryRunner.query(
      `CREATE INDEX "IDX_OUTBOX_UNPUBLISHED" ON "outbox_events" ("published", "created_at") WHERE "published" = false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('outbox_events', 'IDX_OUTBOX_UNPUBLISHED');
    await queryRunner.dropIndex('outbox_events', 'IDX_OUTBOX_CREATED_AT');
    await queryRunner.dropIndex('outbox_events', 'IDX_OUTBOX_EVENT_TYPE');
    await queryRunner.dropIndex('outbox_events', 'IDX_OUTBOX_PUBLISHED');
    await queryRunner.dropTable('outbox_events');
  }
}
