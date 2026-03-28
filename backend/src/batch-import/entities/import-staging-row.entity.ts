import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

import { ImportRowStatus } from '../enums/import.enum';

@Entity('import_staging_rows')
@Index('idx_staging_batch', ['batchId'])
export class ImportStagingRowEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @Column({ name: 'row_index', type: 'int' })
  rowIndex: number;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>;

  @Column({ type: 'enum', enum: ImportRowStatus })
  status: ImportRowStatus;

  @Column({ type: 'simple-array', nullable: true })
  errors: string[] | null;

  /** Set after commit — the created domain record id */
  @Column({ name: 'committed_id', type: 'uuid', nullable: true })
  committedId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
