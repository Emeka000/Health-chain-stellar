import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ReservationAuditAction {
  RESERVED = 'RESERVED',
  RELEASED = 'RELEASED',
  EXPIRED_RELEASED = 'EXPIRED_RELEASED',
  ALLOCATED = 'ALLOCATED',
}

/**
 * Immutable audit trail for every reservation state change.
 * Expiration auto-releases are recorded here for full traceability.
 */
@Entity('reservation_audit_log')
@Index('idx_res_audit_request', ['requestId'])
@Index('idx_res_audit_action', ['action'])
@Index('idx_res_audit_created', ['createdAt'])
export class ReservationAuditEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'request_id', type: 'uuid' })
  requestId: string;

  @Column({ name: 'blood_bank_id', type: 'varchar', length: 64 })
  bloodBankId: string;

  @Column({ name: 'blood_type', type: 'varchar', length: 16 })
  bloodType: string;

  @Column({ name: 'quantity_ml', type: 'int' })
  quantityMl: number;

  @Column({ type: 'enum', enum: ReservationAuditAction })
  action: ReservationAuditAction;

  @Column({ name: 'urgency', type: 'varchar', length: 32, nullable: true })
  urgency: string | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
