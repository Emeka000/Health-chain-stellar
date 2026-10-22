import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * Migration to enhance audit_logs table with:
 * - category and severity fields for classification
 * - user_agent for device tracking
 * - correlation_id for distributed tracing
 * - metadata for additional context
 * - Additional indexes for efficient querying
 */
export class EnhanceAuditLogsTable1910000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns
    await queryRunner.addColumn(
      'audit_logs',
      new TableColumn({
        name: 'category',
        type: 'varchar',
        length: '64',
        isNullable: true,
        comment:
          'Audit category (authentication, financial, privileged_access, etc.)',
      }),
    );

    await queryRunner.addColumn(
      'audit_logs',
      new TableColumn({
        name: 'severity',
        type: 'varchar',
        length: '32',
        isNullable: true,
        comment: 'Severity level (critical, high, medium, low)',
      }),
    );

    await queryRunner.addColumn(
      'audit_logs',
      new TableColumn({
        name: 'user_agent',
        type: 'varchar',
        length: '512',
        isNullable: true,
        comment: 'User agent string from the request',
      }),
    );

    await queryRunner.addColumn(
      'audit_logs',
      new TableColumn({
        name: 'correlation_id',
        type: 'varchar',
        length: '64',
        isNullable: true,
        comment: 'Correlation ID for tracing related operations',
      }),
    );

    await queryRunner.addColumn(
      'audit_logs',
      new TableColumn({
        name: 'metadata',
        type: 'jsonb',
        isNullable: true,
        comment:
          'Additional context metadata (reason, comment, geo location, etc.)',
      }),
    );

    // Create new indexes for efficient querying
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_correlation',
        columnNames: ['correlation_id'],
      }),
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_category',
        columnNames: ['category'],
      }),
    );

    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_severity',
        columnNames: ['severity'],
      }),
    );

    // Composite index for category + severity queries
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_category_severity',
        columnNames: ['category', 'severity'],
      }),
    );

    // Composite index for actor + timestamp for user activity tracking
    await queryRunner.createIndex(
      'audit_logs',
      new TableIndex({
        name: 'idx_audit_logs_actor_timestamp',
        columnNames: ['actor_id', 'timestamp'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.dropIndex('audit_logs', 'idx_audit_logs_actor_timestamp');
    await queryRunner.dropIndex(
      'audit_logs',
      'idx_audit_logs_category_severity',
    );
    await queryRunner.dropIndex('audit_logs', 'idx_audit_logs_severity');
    await queryRunner.dropIndex('audit_logs', 'idx_audit_logs_category');
    await queryRunner.dropIndex('audit_logs', 'idx_audit_logs_correlation');

    // Drop columns
    await queryRunner.dropColumn('audit_logs', 'metadata');
    await queryRunner.dropColumn('audit_logs', 'correlation_id');
    await queryRunner.dropColumn('audit_logs', 'user_agent');
    await queryRunner.dropColumn('audit_logs', 'severity');
    await queryRunner.dropColumn('audit_logs', 'category');
  }
}
