import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ReportStatus } from '../enums/report-status.enum';

@Entity('generated_reports')
@Index(['hospitalId', 'status'])
@Index(['createdByUserId'])
export class GeneratedReportEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  type: string;

  @Column({
    type: 'enum',
    enum: ReportStatus,
    default: ReportStatus.PENDING,
  })
  status: ReportStatus;

  @Column({ type: 'varchar', length: 10 })
  format: 'pdf' | 'csv';

  @Column({ type: 'jsonb', nullable: true })
  parameters: any;

  @Column({ name: 'hospital_id', type: 'varchar', length: 64, nullable: true })
  hospitalId: string | null;

  @Column({ name: 'created_by_user_id', type: 'varchar', length: 64 })
  createdByUserId: string;

  @Column({ name: 'file_path', type: 'text', nullable: true })
  filePath: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'correlation_id', type: 'varchar', length: 128, nullable: true })
  correlationId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
