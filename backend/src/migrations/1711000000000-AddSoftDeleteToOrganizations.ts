import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddSoftDeleteToOrganizations1711000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'organizations',
      new TableColumn({
        name: 'deleted_at',
        type: 'timestamp',
        isNullable: true,
        default: null,
      }),
    );

    await queryRunner.createIndex('organizations', new TableIndex({
      name: 'IDX_ORGANIZATIONS_DELETED_AT',
      columnNames: ['deleted_at'],
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('organizations', 'IDX_ORGANIZATIONS_DELETED_AT');
    await queryRunner.dropColumn('organizations', 'deleted_at');
  }
}
