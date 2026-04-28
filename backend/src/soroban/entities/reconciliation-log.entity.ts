import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

export enum PaymentEventType {
  PAYMENT_RELEASED = 'payment.released',
  PAYMENT_REFUNDED = 'payment.refunded',
}

export enum ReconciliationLogStatus {
  RESOLVED = 'resolved',
  DISCREPANCY = 'discrepancy',
}

@Entity('soroban_reconciliation_logs')
@Index(['onChainPaymentId'])
@Index(['status'])
@Index(['ledgerSequence'])
export class ReconciliationLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'on_chain_payment_id', type: 'varchar' })
  onChainPaymentId: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType: string;

  @Column({ name: 'ledger_sequence', type: 'bigint' })
  ledgerSequence: number;

  @Column({ name: 'on_chain_payment_status', type: 'varchar' })
  onChainPaymentStatus: string;

  @Column({ name: 'off_chain_payment_status', type: 'varchar', nullable: true })
  offChainPaymentStatus: string | null;

  @Column({
    name: 'status',
    type: 'varchar',
    default: ReconciliationLogStatus.RESOLVED,
  })
  status: ReconciliationLogStatus;

  @Column({ name: 'discrepancy_detail', type: 'text', nullable: true })
  discrepancyDetail: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
