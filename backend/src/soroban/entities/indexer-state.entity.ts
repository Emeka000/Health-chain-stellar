import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('soroban_indexer_state')
export class IndexerStateEntity {
  /** Unique key identifying the indexer job (e.g. 'payment-reconciliation') */
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  /** Last ledger sequence successfully processed */
  @Column({ name: 'last_ledger_sequence', type: 'bigint', default: 0 })
  lastLedgerSequence: number;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
