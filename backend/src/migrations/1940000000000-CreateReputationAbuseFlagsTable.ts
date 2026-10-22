import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateReputationAbuseFlagsTable1940000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'reputation_abuse_flags',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'rider_id', type: 'varchar', length: '64' },
          { name: 'history_id', type: 'varchar', length: '64', isNullable: true },
          { name: 'flag', type: 'varchar', length: '64' },
          { name: 'status', type: 'varchar', length: '32', default: "'pending'" },
          { name: 'evidence', type: 'jsonb', isNullable: true },
          { name: 'withheld_delta', type: 'float', default: 0 },
          { name: 'reviewed_by', type: 'varchar', length: '64', isNullable: true },
          { name: 'reviewed_at', type: 'timestamptz', isNullable: true },
          { name: 'review_note', type: 'text', isNullable: true },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'reputation_abuse_flags',
      new TableIndex({ name: 'idx_rep_abuse_rider', columnNames: ['rider_id'] }),
    );
    await queryRunner.createIndex(
      'reputation_abuse_flags',
      new TableIndex({ name: 'idx_rep_abuse_status', columnNames: ['status'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('reputation_abuse_flags', true);
  }
}
