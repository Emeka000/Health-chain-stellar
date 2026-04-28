import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddRiderAvailabilityFields1870000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('riders', [
      new TableColumn({
        name: 'last_location_updated_at',
        type: 'timestamp',
        isNullable: true,
      }),
      new TableColumn({
        name: 'working_hours',
        type: 'jsonb',
        isNullable: true,
      }),
      new TableColumn({
        name: 'preferred_areas',
        type: 'jsonb',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('riders', 'last_location_updated_at');
    await queryRunner.dropColumn('riders', 'working_hours');
    await queryRunner.dropColumn('riders', 'preferred_areas');
  }
}
