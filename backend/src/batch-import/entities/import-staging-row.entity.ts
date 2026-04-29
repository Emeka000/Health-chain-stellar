import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  UpdateDateColumn,
} from 'typeorm';

import { ImportRowStatus, QuarantineReasonCode } from '../enums/import.enum';

@Entity('import_staging_rows')
@Index('idx_staging_batch', ['batchId'])
@Index('IDX_STAGING_ROW_STATUS', ['batchId', 'status'])
export class ImportStagingRowEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Column({ name: 'row_index', type: 'int' })
  rowIndex: number;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>;

  @Column({ type: 'varchar', length: 32, default: ImportRowStatus.VALID })
  status: ImportRowStatus;

  /** Human-readable validation error messages. */
  @Column({ type: 'simple-array', nullable: true })
  errors: string[] | null;

  /**
   * Structured quarantine reason code for programmatic filtering.
   * Set when status = QUARANTINED.
   */
  @Column({
    name: 'quarantine_reason_code',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  quarantineReasonCode: QuarantineReasonCode | null;

  /**
   * SHA-256 of the canonical row data.
   * Used for cross-batch deduplication: if the same row was committed
   * in a previous batch, this row is marked DUPLICATE.
   */
  @Column({ name: 'row_hash', type: 'varchar', length: 64, nullable: true })
  rowHash: string | null;

  /** Set after commit — the created domain record id. */
  @Column({ name: 'committed_id', type: 'varchar', nullable: true })
  committedId: string | null;

  /** Chunk index this row belongs to (for checkpoint tracking). */
  @Column({ name: 'chunk_index', type: 'int', nullable: true })
  chunkIndex: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
