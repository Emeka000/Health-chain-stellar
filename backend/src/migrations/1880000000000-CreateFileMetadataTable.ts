import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateFileMetadataTable1880000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'file_metadata',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'owner_type', type: 'varchar', length: '64' },
          { name: 'owner_id', type: 'varchar', length: '64' },
          { name: 'storage_path', type: 'varchar', length: '512' },
          { name: 'original_filename', type: 'varchar', length: '255', isNullable: true },
          { name: 'content_type', type: 'varchar', length: '128', isNullable: true },
          { name: 'size_bytes', type: 'bigint', isNullable: true },
          { name: 'sha256_hash', type: 'varchar', length: '64', isNullable: true },
          { name: 'status', type: 'varchar', length: '32', default: "'active'" },
          { name: 'deleted_at', type: 'timestamptz', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'file_metadata',
      new TableIndex({ name: 'idx_file_metadata_owner', columnNames: ['owner_type', 'owner_id'] }),
    );
    await queryRunner.createIndex(
      'file_metadata',
      new TableIndex({ name: 'idx_file_metadata_status', columnNames: ['status'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('file_metadata', true);
  }
}
