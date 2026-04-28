import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import {
  ReadinessChecklistStatus,
  ReadinessEntityType,
} from '../enums/readiness.enum';

import { ReadinessItemEntity } from './readiness-item.entity';

@Entity('readiness_checklists')
@Index('idx_rc_entity', ['entityType', 'entityId'], { unique: true })
@Index('idx_rc_status', ['status'])
export class ReadinessChecklistEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_type', type: 'enum', enum: ReadinessEntityType })
  entityType: ReadinessEntityType;

  /** organizationId or regionId */
  @Column({ name: 'entity_id', type: 'varchar', length: 64 })
  entityId: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ReadinessChecklistStatus,
    default: ReadinessChecklistStatus.INCOMPLETE,
  })
  status: ReadinessChecklistStatus;

  @Column({
    name: 'signed_off_by',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  signedOffBy: string | null;

  @Column({ name: 'signed_off_at', type: 'timestamptz', nullable: true })
  signedOffAt: Date | null;

  @Column({ name: 'reviewer_notes', type: 'text', nullable: true })
  reviewerNotes: string | null;

  @OneToMany(() => ReadinessItemEntity, (item) => item.checklist, {
    cascade: true,
    eager: true,
  })
  items: ReadinessItemEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
