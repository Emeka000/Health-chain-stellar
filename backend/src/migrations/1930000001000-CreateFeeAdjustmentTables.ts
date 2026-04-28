import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

/**
 * Migration: Fee Adjustment / Retroactive Correction Tables
 *
 * Creates:
 *  - fee_correction_runs   – tracks a batch correction job (idempotent, resumable)
 *  - fee_adjustment_entries – additive, immutable correction records per order
 *
 * Historical records (orders.fee_breakdown) are NEVER mutated.
 * All corrections are expressed as signed delta entries that reconcile
 * against the original fee_breakdown.
 */
export class CreateFeeAdjustmentTables1930000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. fee_correction_runs ─────────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'fee_correction_runs',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          {
            name: 'idempotency_key',
            type: 'varchar',
            length: '128',
            isNullable: false,
            isUnique: true,
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            isNullable: false,
            default: "'PENDING'",
          },
          {
            name: 'policy_snapshot_id',
            type: 'uuid',
            isNullable: false,
            comment: 'The fee policy ID whose bug triggered this correction run',
          },
          {
            name: 'corrected_policy_id',
            type: 'uuid',
            isNullable: false,
            comment: 'The replacement/corrected fee policy ID to recompute under',
          },
          {
            name: 'affected_from',
            type: 'timestamptz',
            isNullable: false,
            comment: 'Start of the affected order window',
          },
          {
            name: 'affected_to',
            type: 'timestamptz',
            isNullable: false,
            comment: 'End of the affected order window',
          },
          {
            name: 'total_affected',
            type: 'int',
            isNullable: false,
            default: 0,
          },
          {
            name: 'total_processed',
            type: 'int',
            isNullable: false,
            default: 0,
          },
          {
            name: 'cursor_order_id',
            type: 'uuid',
            isNullable: true,
            comment: 'Resume cursor: last processed order ID for idempotent reruns',
          },
          {
            name: 'approval_request_id',
            type: 'uuid',
            isNullable: true,
            comment: 'Linked approval request that must be APPROVED before execution',
          },
          {
            name: 'initiated_by',
            type: 'varchar',
            length: '120',
            isNullable: false,
          },
          {
            name: 'executed_by',
            type: 'varchar',
            length: '120',
            isNullable: true,
          },
          {
            name: 'error_message',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'completed_at',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'NOW()',
          },
          {
            name: 'updated_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'fee_correction_runs',
      new TableIndex({
        name: 'IDX_FEE_CORRECTION_RUNS_STATUS',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'fee_correction_runs',
      new TableIndex({
        name: 'IDX_FEE_CORRECTION_RUNS_POLICY',
        columnNames: ['policy_snapshot_id'],
      }),
    );

    // ── 2. fee_adjustment_entries ──────────────────────────────────────────
    await queryRunner.createTable(
      new Table({
        name: 'fee_adjustment_entries',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          {
            name: 'correction_run_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'order_id',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'original_policy_id',
            type: 'uuid',
            isNullable: false,
            comment: 'Policy that was applied when the order was placed',
          },
          {
            name: 'corrected_policy_id',
            type: 'uuid',
            isNullable: false,
            comment: 'Policy used to recompute the corrected fee',
          },
          {
            name: 'original_fee_breakdown',
            type: 'jsonb',
            isNullable: false,
            comment: 'Snapshot of orders.fee_breakdown at correction time (immutable reference)',
          },
          {
            name: 'corrected_fee_breakdown',
            type: 'jsonb',
            isNullable: false,
            comment: 'Recomputed fee breakdown under the corrected policy',
          },
          {
            name: 'delta_delivery_fee',
            type: 'numeric',
            precision: 12,
            scale: 4,
            isNullable: false,
            comment: 'corrected - original (signed)',
          },
          {
            name: 'delta_platform_fee',
            type: 'numeric',
            precision: 12,
            scale: 4,
            isNullable: false,
          },
          {
            name: 'delta_performance_fee',
            type: 'numeric',
            precision: 12,
            scale: 4,
            isNullable: false,
          },
          {
            name: 'delta_total_fee',
            type: 'numeric',
            precision: 12,
            scale: 4,
            isNullable: false,
          },
          {
            name: 'reconciliation_link',
            type: 'varchar',
            length: '255',
            isNullable: true,
            comment: 'Reference to the compensating payment/accounting entry',
          },
          {
            name: 'audit_hash',
            type: 'varchar',
            length: '128',
            isNullable: false,
            comment: 'Deterministic hash of inputs for reproducibility verification',
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            isNullable: false,
            default: "'PENDING'",
          },
          {
            name: 'created_at',
            type: 'timestamptz',
            isNullable: false,
            default: 'NOW()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'fee_adjustment_entries',
      new TableIndex({
        name: 'IDX_FEE_ADJ_ORDER_ID',
        columnNames: ['order_id'],
      }),
    );

    await queryRunner.createIndex(
      'fee_adjustment_entries',
      new TableIndex({
        name: 'IDX_FEE_ADJ_RUN_ID',
        columnNames: ['correction_run_id'],
      }),
    );

    await queryRunner.createIndex(
      'fee_adjustment_entries',
      new TableIndex({
        name: 'IDX_FEE_ADJ_STATUS',
        columnNames: ['status'],
      }),
    );

    // Unique constraint: one adjustment entry per order per correction run
    await queryRunner.createIndex(
      'fee_adjustment_entries',
      new TableIndex({
        name: 'UQ_FEE_ADJ_ORDER_RUN',
        columnNames: ['order_id', 'correction_run_id'],
        isUnique: true,
      }),
    );

    // FK: fee_adjustment_entries → fee_correction_runs
    await queryRunner.createForeignKey(
      'fee_adjustment_entries',
      new TableForeignKey({
        name: 'FK_FEE_ADJ_CORRECTION_RUN',
        columnNames: ['correction_run_id'],
        referencedTableName: 'fee_correction_runs',
        referencedColumnNames: ['id'],
        onDelete: 'RESTRICT',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropForeignKey('fee_adjustment_entries', 'FK_FEE_ADJ_CORRECTION_RUN');
    await queryRunner.dropTable('fee_adjustment_entries');
    await queryRunner.dropTable('fee_correction_runs');
  }
}
