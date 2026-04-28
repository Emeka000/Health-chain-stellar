import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ContractDomain {
  IDENTITY = 'identity',
  REQUEST = 'request',
  INVENTORY = 'inventory',
  DELIVERY = 'delivery',
  PAYMENT = 'payment',
}

@Entity('contract_events')
@Index('idx_ce_domain_type', ['domain', 'eventType'])
@Index('idx_ce_ledger', ['ledgerSequence'])
@Index('idx_ce_contract_ref', ['contractRef'])
@Index('idx_ce_dedup_key', ['dedupKey'], { unique: true })
@Index('idx_ce_indexed_at', ['indexedAt'])
export class ContractEventEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Which contract domain emitted this event */
  @Column({ name: 'domain', type: 'enum', enum: ContractDomain })
  domain: ContractDomain;

  /** Normalized event type, e.g. "identity.registered", "payment.released" */
  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  /** Soroban contract ID that emitted the event */
  @Column({
    name: 'contract_ref',
    type: 'varchar',
    length: 128,
    nullable: true,
  })
  contractRef: string | null;

  /** Ledger sequence number at which the event was emitted */
  @Column({ name: 'ledger_sequence', type: 'bigint' })
  ledgerSequence: number;

  /** Transaction hash on Stellar */
  @Column({ name: 'tx_hash', type: 'varchar', length: 128, nullable: true })
  txHash: string | null;

  /** Normalized, domain-specific payload */
  @Column({ name: 'payload', type: 'jsonb' })
  payload: Record<string, unknown>;

  /** SHA-256(domain + eventType + txHash + ledgerSequence) — prevents duplicate ingestion */
  @Column({ name: 'dedup_key', type: 'varchar', length: 64 })
  dedupKey: string;

  /** Optional reference to an off-chain entity (orderId, donorId, etc.) */
  @Column({ name: 'entity_ref', type: 'varchar', length: 128, nullable: true })
  entityRef: string | null;

  @CreateDateColumn({ name: 'indexed_at' })
  indexedAt: Date;
}
