import {
  Entity,
  Column,
  Index,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum LegalHoldStatus {
  ACTIVE = 'active',
  RELEASED = 'released',
}

/**
 * Legal hold record — blocks purge/anonymization for a specific entity.
 * Legal holds take precedence over all retention policy actions.
 */
@Entity('legal_holds')
@Index('idx_legal_holds_entity', ['entityType', 'entityId'])
@Index('idx_legal_holds_status', ['status'])
export class LegalHoldEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'entity_type', type: 'varchar' })
  entityType: string;

  @Column({ name: 'entity_id', type: 'varchar' })
  entityId: string;

  @Column({ name: 'reason', type: 'text' })
  reason: string;

  @Column({ name: 'placed_by', type: 'varchar' })
  placedBy: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: LegalHoldStatus,
    default: LegalHoldStatus.ACTIVE,
  })
  status: LegalHoldStatus;

  @Column({ name: 'released_by', type: 'varchar', nullable: true })
  releasedBy: string | null;

  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
