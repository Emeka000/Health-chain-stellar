import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddOrderFeeFields1800000001000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn('orders', new TableColumn({
            name: 'fee_breakdown',
            type: 'jsonb',
            isNullable: true,
        }));

        await queryRunner.addColumn('orders', new TableColumn({
            name: 'applied_policy_id',
            type: 'uuid',
            isNullable: true,
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('orders', 'applied_policy_id');
        await queryRunner.dropColumn('orders', 'fee_breakdown');
    }
}
