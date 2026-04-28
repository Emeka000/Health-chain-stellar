import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ReadinessItemKey, ReadinessItemStatus } from '../enums/readiness.enum';

import { ReadinessChecklistEntity } from './readiness-checklist.entity';

@Entity('readiness_items')
@Index('idx_ri_checklist', ['checklistId'])
@Index('idx_ri_status', ['status'])
export class ReadinessItemEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'checklist_id', type: 'uuid' })
  checklistId: string;

  @ManyToOne(() => ReadinessChecklistEntity, (c) => c.items, {
    onDelete: 'CASCADE',
  })
  checklist: ReadinessChecklistEntity;

  @Column({ name: 'item_key', type: 'enum', enum: ReadinessItemKey })
  itemKey: ReadinessItemKey;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ReadinessItemStatus,
    default: ReadinessItemStatus.PENDING,
  })
  status: ReadinessItemStatus;

  /** URL or path to uploaded evidence document */
  @Column({ name: 'evidence_url', type: 'text', nullable: true })
  evidenceUrl: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  /** ISO timestamp when this item was last completed/waived */
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'completed_by', type: 'varchar', length: 64, nullable: true })
  completedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
