import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateFeePoliciesTable1800000000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.createTable(
            new Table({
                name: 'fee_policies',
                columns: [
                    {
                        name: 'id',
                        type: 'uuid',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'uuid',
                    },
                    {
                        name: 'geography_code',
                        type: 'varchar',
                        length: '10',
                        isNullable: false,
                    },
                    {
                        name: 'urgency_tier',
                        type: 'varchar',
                        isNullable: false,
                    },
                    {
                        name: 'min_distance_km',
                        type: 'decimal',
                        precision: 6,
                        scale: 2,
                        isNullable: false,
                        default: '0',
                    },
                    {
                        name: 'max_distance_km',
                        type: 'decimal',
                        precision: 6,
                        scale: 2,
                        isNullable: true,
                    },
                    {
                        name: 'service_level',
                        type: 'varchar',
                        isNullable: false,
                    },
                    {
                        name: 'delivery_fee_rate',
                        type: 'decimal',
                        precision: 8,
                        scale: 4,
                        isNullable: false,
                        default: '0',
                    },
                    {
                        name: 'platform_fee_pct',
                        type: 'decimal',
                        precision: 5,
                        scale: 4,
                        isNullable: false,
                        default: '0',
                    },
                    {
                        name: 'performance_multiplier',
                        type: 'decimal',
                        precision: 8,
                        scale: 4,
                        isNullable: false,
                        default: '0',
                    },
                    {
                        name: 'fixed_fee',
                        type: 'decimal',
                        precision: 10,
                        scale: 2,
                        isNullable: true,
                        default: '0',
                    },
                    {
                        name: 'waived_for',
                        type: 'varchar',
                        isNullable: true,
                    },
                    {
                        name: 'priority',
                        type: 'integer',
                        isNullable: false,
                        default: 1,
                    },
                    {
                        name: 'effective_from',
                        type: 'timestamp',
                        isNullable: false,
                    },
                    {
                        name: 'effective_to',
                        type: 'timestamp',
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
                        onUpdate: 'CURRENT_TIMESTAMP',
                    },
                ],
            }),
            true,
        );

        await queryRunner.createIndex(
            'fee_policies',
            new TableIndex({
                name: 'idx_policy_match',
                columnNames: ['geography_code', 'urgency_tier', 'min_distance_km', 'service_level', 'effective_from'],
            }),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex('fee_policies', 'idx_policy_match');
        await queryRunner.dropTable('fee_policies');
    }
}
