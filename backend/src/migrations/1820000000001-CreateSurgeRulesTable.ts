import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateSurgeRulesTable1820000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE blood_type_enum AS ENUM ('A+','A-','B+','B-','AB+','AB-','O+','O-')
    `).catch(() => { /* enum may already exist */ });

    await queryRunner.createTable(
      new Table({
        name: 'surge_rules',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true, generationStrategy: 'uuid', default: 'gen_random_uuid()' },
          { name: 'blood_type', type: 'blood_type_enum' },
          { name: 'threshold', type: 'int' },
          { name: 'multiplier', type: 'decimal', precision: 5, scale: 2 },
          { name: 'max_multiplier', type: 'decimal', precision: 5, scale: 2, default: '3' },
          { name: 'active', type: 'boolean', default: 'false' },
          { name: 'created_at', type: 'timestamptz', default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'surge_rules',
      new TableIndex({ name: 'IDX_surge_rules_blood_type', columnNames: ['blood_type'], isUnique: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('surge_rules', true);
  }
}
