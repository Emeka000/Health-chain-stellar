import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import { ImportBatchStatus, ImportEntityType } from '../enums/import.enum';

@Entity('import_batches')
@Index('IDX_IMPORT_BATCH_STATUS', ['status'])
@Index('IDX_IMPORT_BATCH_FILE_HASH', ['fileHash'])
export class ImportBatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ImportEntityType })
  entityType: ImportEntityType;

  @Column({ type: 'enum', enum: ImportBatchStatus, default: ImportBatchStatus.STAGED })
  status: ImportBatchStatus;

  @Column({ name: 'total_rows', type: 'int' })
  totalRows: number;

  @Column({ name: 'valid_rows', type: 'int', default: 0 })
  validRows: number;

  @Column({ name: 'invalid_rows', type: 'int', default: 0 })
  invalidRows: number;

  @Column({ name: 'committed_rows', type: 'int', default: 0 })
  committedRows: number;

  @Column({ name: 'quarantined_rows', type: 'int', default: 0 })
  quarantinedRows: number;

  @Column({ name: 'duplicate_rows', type: 'int', default: 0 })
  duplicateRows: number;

  @Column({ name: 'failed_rows', type: 'int', default: 0 })
  failedRows: number;

  @Column({ name: 'imported_by', type: 'varchar' })
  importedBy: string;

  @Column({ name: 'original_filename', type: 'varchar', nullable: true })
  originalFilename: string | null;

  /**
   * SHA-256 of the raw CSV buffer.
   * Used for idempotent deduplication: a second upload of the same file
   * returns the original batch without re-processing.
   */
  @Column({ name: 'file_hash', type: 'varchar', length: 64, nullable: true })
  fileHash: string | null;

  /**
   * Chunk size used when committing rows.
   * Stored so a resumed job uses the same chunk size.
   */
  @Column({ name: 'chunk_size', type: 'int', default: 100 })
  chunkSize: number;

  /**
   * Index of the last successfully committed chunk (0-based).
   * NULL = no chunks committed yet.
   * Resume starts from (lastCommittedChunk + 1).
   */
  @Column({ name: 'last_committed_chunk', type: 'int', nullable: true })
  lastCommittedChunk: number | null;

  /** Number of commit retry attempts for the current chunk. */
  @Column({ name: 'retry_count', type: 'int', default: 0 })
  retryCount: number;

  /** Error detail from the last interrupted chunk. */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
