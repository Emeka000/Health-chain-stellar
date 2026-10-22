import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Records every mutable metadata update for auditability */
@Entity('file_metadata_audit_log')
@Index('idx_fmal_file_id', ['fileId'])
@Index('idx_fmal_actor', ['actorId'])
export class FileMetadataAuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'file_id', type: 'uuid' })
  fileId: string;

  /** Version number of this update (1-based) */
  @Column({ name: 'version', type: 'int' })
  version: number;

  /** Actor who performed the update */
  @Column({ name: 'actor_id', type: 'varchar', length: 255 })
  actorId: string;

  /** Human-readable reason for the update */
  @Column({ name: 'reason', type: 'text' })
  reason: string;

  /** Snapshot of mutable fields before the change */
  @Column({ name: 'previous_values', type: 'jsonb', nullable: true })
  previousValues: Record<string, unknown> | null;

  /** Snapshot of mutable fields after the change */
  @Column({ name: 'new_values', type: 'jsonb' })
  newValues: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
