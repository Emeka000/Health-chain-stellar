import { MigrationInterface, QueryRunner, Table, TableIndex, TableForeignKey } from 'typeorm';

export class AddQuarantineCaseAndUnitDisposition1973000000000 implements MigrationInterface {
  name = 'AddQuarantineCaseAndUnitDisposition1973000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create blood_unit_quarantine_cases table
    await queryRunner.createTable(
      new Table({
        name: 'blood_unit_quarantine_cases',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'blood_unit_id',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'trigger_source',
            type: 'enum',
            enum: ['SYSTEM', 'MANUAL', 'COMPLIANCE', 'AUDIT'],
            isNullable: false,
          },
          {
            name: 'reason_code',
            type: 'enum',
            enum: [
              'TEMP_EXCURSION',
              'PATHOGEN_EXPOSURE',
              'DONOR_ELIGIBILITY',
              'QUALITY_FLAG',
              'COMPLIANCE_HOLD',
              'MANUAL_REVIEW',
              'INCIDENT_INVESTIGATION',
            ],
            isNullable: false,
          },
          {
            name: 'reason',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'review_state',
            type: 'enum',
            enum: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'],
            default: "'PENDING'",
            isNullable: false,
          },
          {
            name: 'reviewer_assigned_to',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'reviewed_by',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'reviewed_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'final_disposition',
            type: 'enum',
            enum: [
              'RELEASE_CLEARED',
              'USAGE_RESTRICTED',
              'TRANSFUSION_EXCLUDED',
              'RESEARCH_ONLY',
              'DISCARD',
            ],
            isNullable: true,
          },
          {
            name: 'disposition_notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'disposition_at',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'policy_reference',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'evidence',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'active',
            type: 'boolean',
            default: true,
            isNullable: false,
          },
          {
            name: 'created_by',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'created_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
          {
            name: 'updated_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Add indexes to blood_unit_quarantine_cases
    await queryRunner.createIndex(
      'blood_unit_quarantine_cases',
      new TableIndex({
        name: 'idx_quarantine_case_unit_id',
        columnNames: ['blood_unit_id'],
      }),
    );

    await queryRunner.createIndex(
      'blood_unit_quarantine_cases',
      new TableIndex({
        name: 'idx_quarantine_case_active',
        columnNames: ['active'],
      }),
    );

    await queryRunner.createIndex(
      'blood_unit_quarantine_cases',
      new TableIndex({
        name: 'idx_quarantine_case_review_state',
        columnNames: ['review_state'],
      }),
    );

    // Create unit_dispositions table
    await queryRunner.createTable(
      new Table({
        name: 'unit_dispositions',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'uuid_generate_v4()',
          },
          {
            name: 'blood_unit_id',
            type: 'varchar',
            isNullable: false,
          },
          {
            name: 'disposition',
            type: 'enum',
            enum: [
              'TRANSFUSABLE',
              'RESTRICTED',
              'RESEARCH_ONLY',
              'DISCARDED',
              'QUARANTINED',
            ],
            isNullable: false,
          },
          {
            name: 'reason',
            type: 'enum',
            enum: [
              'QUALITY_CHECK_FAIL',
              'EXPIRED',
              'CONTAMINATED',
              'TEMP_BREACH',
              'DONOR_INELIGIBLE',
              'REQUEST_FULFILLED',
              'MANUAL_DISPOSITION',
            ],
            isNullable: false,
          },
          {
            name: 'notes',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'decided_by',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'elapsed_time_minutes',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'temperature_breach',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'cold_chain_verified',
            type: 'boolean',
            default: false,
            isNullable: false,
          },
          {
            name: 'decided_at',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            isNullable: false,
          },
        ],
      }),
      true,
    );

    // Add foreign key for unit_dispositions
    await queryRunner.createForeignKey(
      'unit_dispositions',
      new TableForeignKey({
        columnNames: ['blood_unit_id'],
        referencedTableName: 'blood_units',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop unit_dispositions table
    await queryRunner.dropTable('unit_dispositions', true);

    // Drop blood_unit_quarantine_cases table
    await queryRunner.dropTable('blood_unit_quarantine_cases', true);
  }
}
