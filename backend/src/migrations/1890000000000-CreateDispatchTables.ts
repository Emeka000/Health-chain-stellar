import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDispatchTables1890000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dispatch_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id VARCHAR NOT NULL,
        rider_id VARCHAR,
        status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
        cancel_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_DISPATCH_ORDER_ID ON dispatch_records (order_id)
    `);

    await queryRunner.query(`
      CREATE TABLE dispatch_status_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dispatch_id UUID NOT NULL REFERENCES dispatch_records(id) ON DELETE CASCADE,
        status VARCHAR(16) NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IDX_DISPATCH_HISTORY_DISPATCH_ID ON dispatch_status_history (dispatch_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS dispatch_status_history`);
    await queryRunner.query(`DROP TABLE IF EXISTS dispatch_records`);
  }
}
