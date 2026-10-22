import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum OnChainTxStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  FINAL = 'final',
  FAILED = 'failed',
}

/**
 * Durable record of every on-chain transaction lifecycle milestone.
 *
 * One row per transaction hash. Status transitions are monotonic:
 *   pending → confirmed → final
 *   pending → failed
 *
 * The `emittedEvents` bitmask tracks which domain events have already been
 * published so that retried callbacks cannot produce duplicate effects.
 */
@Entity('on_chain_tx_states')
@Index('IDX_ON_CHAIN_TX_HASH', ['transactionHash'], { unique: true })
@Index('IDX_ON_CHAIN_TX_STATUS', ['status'])
@Index('IDX_ON_CHAIN_TX_CONTRACT_METHOD', ['contractMethod'])
export class OnChainTxStateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'transaction_hash', type: 'varchar', length: 128 })
  transactionHash: string;

  @Column({ name: 'contract_method', type: 'varchar', length: 128 })
  contractMethod: string;

  /** Idempotency key of the originating job submission. */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true })
  idempotencyKey: string | null;

  @Column({
    type: 'varchar',
    length: 32,
    default: OnChainTxStatus.PENDING,
  })
  status: OnChainTxStatus;

  /** Cumulative confirmation count from all callbacks received so far. */
  @Column({ type: 'int', default: 0 })
  confirmations: number;

  /** Minimum confirmations required for finality (copied from env at write time). */
  @Column({ name: 'finality_threshold', type: 'int', default: 1 })
  finalityThreshold: number;

  /**
   * Bitmask of domain events already emitted.
   * Bit 0 = pending, Bit 1 = confirmed, Bit 2 = final, Bit 3 = failed.
   * Prevents duplicate event emission on retried callbacks.
   */
  @Column({ name: 'emitted_events', type: 'int', default: 0 })
  emittedEvents: number;

  /** Optional error detail when status = failed. */
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  /** Arbitrary metadata from the originating job (e.g. orgId, orderId). */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

/** Bitmask constants for emittedEvents field. */
export const TX_EVENT_BIT = {
  PENDING: 1,
  CONFIRMED: 2,
  FINAL: 4,
  FAILED: 8,
} as const;
