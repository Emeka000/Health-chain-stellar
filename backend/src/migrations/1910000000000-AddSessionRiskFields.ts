import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/**
 * Adds session risk scoring columns to auth_sessions:
 *   - risk_score      INT        (0–100)
 *   - risk_level      VARCHAR    (low/medium/high/critical)
 *   - risk_signals    JSONB      (geo_velocity, device_mismatch, token_abuse flags)
 *   - step_up_at      TIMESTAMP  (when step-up auth was completed, nullable)
 *   - geo_hint        VARCHAR    (already exists in some envs — added idempotently)
 */
export class AddSessionRiskFields1910000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('auth_sessions');
    if (!table) return;

    const columnsToAdd: TableColumn[] = [];

    if (!table.findColumnByName('risk_score')) {
      columnsToAdd.push(
        new TableColumn({ name: 'risk_score', type: 'int', isNullable: true }),
      );
    }
    if (!table.findColumnByName('risk_level')) {
      columnsToAdd.push(
        new TableColumn({ name: 'risk_level', type: 'varchar', length: '16', isNullable: true }),
      );
    }
    if (!table.findColumnByName('risk_signals')) {
      columnsToAdd.push(
        new TableColumn({ name: 'risk_signals', type: 'jsonb', isNullable: true }),
      );
    }
    if (!table.findColumnByName('step_up_at')) {
      columnsToAdd.push(
        new TableColumn({ name: 'step_up_at', type: 'timestamp', isNullable: true }),
      );
    }
    if (!table.findColumnByName('geo_hint')) {
      columnsToAdd.push(
        new TableColumn({ name: 'geo_hint', type: 'varchar', length: '128', isNullable: true }),
      );
    }

    if (columnsToAdd.length > 0) {
      await queryRunner.addColumns('auth_sessions', columnsToAdd);
    }

    // Index on risk_level for fast policy-based queries
    const existingIndices = table.indices.map((i) => i.name);
    if (!existingIndices.includes('IDX_AUTH_SESSION_RISK_LEVEL')) {
      await queryRunner.createIndex(
        'auth_sessions',
        new TableIndex({
          name: 'IDX_AUTH_SESSION_RISK_LEVEL',
          columnNames: ['risk_level'],
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('auth_sessions', 'IDX_AUTH_SESSION_RISK_LEVEL').catch(() => undefined);
    for (const col of ['risk_score', 'risk_level', 'risk_signals', 'step_up_at']) {
      await queryRunner.dropColumn('auth_sessions', col).catch(() => undefined);
    }
  }
}
