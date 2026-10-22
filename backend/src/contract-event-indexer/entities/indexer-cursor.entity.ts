import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Tracks the highest ledger sequence successfully indexed per domain+projection.
 * Each projection has its own cursor so a failing projection does not stall others.
 */
@Entity('contract_indexer_cursors')
@Index('idx_cursor_domain_projection', ['domain', 'projectionName'], {
  unique: true,
})
export class IndexerCursorEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'domain', type: 'varchar', length: 50 })
  domain: string;

  /**
   * Logical projection name (e.g. "inventory-read-model", "notification-fanout").
   * Use the sentinel value "__global__" for the legacy single-cursor-per-domain behaviour.
   */
  @Column({
    name: 'projection_name',
    type: 'varchar',
    length: 100,
    default: '__global__',
  })
  projectionName: string;

  @Column({ name: 'last_ledger', type: 'bigint', default: 0 })
  lastLedger: number;

  /**
   * Hash of the last indexed ledger (e.g. Stellar ledger hash).
   * Used to detect chain reorganizations: if the incoming ledger hash
   * for the same sequence differs, a reorg has occurred.
   */
  @Column({ name: 'last_ledger_hash', type: 'varchar', length: 128, nullable: true })
  lastLedgerHash: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
