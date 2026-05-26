import {
  BaseEntity,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { DataCategory } from './retention-policy.entity';

export enum RedactionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum SensitiveFieldType {
  TEXT = 'text',
  JSON = 'json',
  FILE_PATH = 'file_path',
  COORDINATES = 'coordinates',
  MEDICAL_DATA = 'medical_data',
}

@Entity('data_redactions')
@Index('idx_data_redactions_entity', ['entityType', 'entityId'])
@Index('idx_data_redactions_status', ['status'])
@Index('idx_data_redactions_category', ['dataCategory'])
export class DataRedactionEntity extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 100 })
  entityType: string; // e.g., 'blood_unit', 'rider', 'organization', 'location_history'

  @Column({ name: 'entity_id', type: 'varchar', length: 255 })
  entityId: string;

  @Column({
    name: 'data_category',
    type: 'enum',
    enum: DataCategory,
  })
  dataCategory: DataCategory;

  @Column({ name: 'field_name', type: 'varchar', length: 255 })
  fieldName: string;

  @Column({
    name: 'field_type',
    type: 'enum',
    enum: SensitiveFieldType,
  })
  fieldType: SensitiveFieldType;

  @Column({ name: 'original_value', type: 'text', nullable: true })
  originalValue?: string;

  @Column({ name: 'redacted_value', type: 'text', nullable: true })
  redactedValue?: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: RedactionStatus,
    default: RedactionStatus.PENDING,
  })
  status: RedactionStatus;

  @Column({ name: 'retention_policy_id', type: 'uuid', nullable: true })
  retentionPolicyId?: string;

  @Column({ name: 'redaction_reason', type: 'text', nullable: true })
  redactionReason?: string;

  @Column({ name: 'executed_by_user_id', type: 'uuid', nullable: true })
  executedByUserId?: string;

  @Column({ name: 'executed_at', type: 'timestamp', nullable: true })
  executedAt?: Date;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}