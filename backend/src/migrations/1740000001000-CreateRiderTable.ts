import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class CreateRiderTable1740000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'riders',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'user_id',
            type: 'uuid',
            isUnique: true,
          },
          {
            name: 'vehicle_type',
            type: 'varchar',
          },
          {
            name: 'vehicle_number',
            type: 'varchar',
          },
          {
            name: 'license_number',
            type: 'varchar',
          },
          {
            name: 'status',
            type: 'varchar',
            default: "'OFFLINE'",
          },
          {
            name: 'latitude',
            type: 'decimal',
            precision: 10,
            scale: 7,
            isNullable: true,
          },
          {
            name: 'longitude',
            type: 'decimal',
            precision: 10,
            scale: 7,
            isNullable: true,
          },
          {
            name: 'identity_document_url',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'vehicle_document_url',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'is_verified',
            type: 'boolean',
            default: false,
          },
          {
            name: 'completed_deliveries',
            type: 'integer',
            default: 0,
          },
          {
            name: 'cancelled_deliveries',
            type: 'integer',
            default: 0,
          },
          {
            name: 'failed_deliveries',
            type: 'integer',
            default: 0,
          },
          {
            name: 'rating',
            type: 'float',
            default: 0,
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

    await queryRunner.createForeignKey(
      'riders',
      new TableForeignKey({
        columnNames: ['user_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'users',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('riders');
  }
}
