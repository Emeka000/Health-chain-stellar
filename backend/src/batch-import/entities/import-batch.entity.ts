import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ImportBatchStatus, ImportEntityType } from '../enums/import.enum';

@Entity('import_batches')
export class ImportBatchEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ImportEntityType })
  entityType: ImportEntityType;

  @Column({ type: 'enum', enum: ImportBatchStatus, default: ImportBatchStatus.STAGED })
  status: ImportBatchStatus;

  @Column({ name: 'total_rows', type: 'int' })
  totalRows: number;

  @Column({ name: 'valid_rows', type: 'int' })
  validRows: number;

  @Column({ name: 'invalid_rows', type: 'int' })
  invalidRows: number;

  @Column({ name: 'imported_by', type: 'varchar' })
  importedBy: string;

  @Column({ name: 'original_filename', type: 'varchar', nullable: true })
  originalFilename: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
