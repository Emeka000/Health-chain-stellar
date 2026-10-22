import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Hash-linked audit chain entry (#631).
 *
 * Each entry stores:
 *  - auditLogId  : FK to the source audit_logs row
 *  - sequence    : monotonically increasing position in the chain
 *  - entryHash   : SHA-256( sequence | auditLogId | previousHash | timestamp )
 *  - previousHash: entryHash of the immediately preceding entry (genesis = '0'.repeat(64))
 *
 * Any tampering with a row makes entryHash inconsistent with its neighbours,
 * which the verifier detects by recomputing the chain.
 */
@Entity('audit_chain_entries')
@Index('idx_ace_sequence', ['sequence'], { unique: true })
@Index('idx_ace_audit_log', ['auditLogId'])
export class AuditChainEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'audit_log_id', type: 'uuid' })
  auditLogId: string;

  @Column({ name: 'sequence', type: 'bigint' })
  sequence: number;

  @Column({ name: 'entry_hash', type: 'varchar', length: 64 })
  entryHash: string;

  @Column({ name: 'previous_hash', type: 'varchar', length: 64 })
  previousHash: string;

  @CreateDateColumn({ name: 'chained_at' })
  chainedAt: Date;
}

/**
 * Periodic checkpoint anchoring the chain root hash at a given sequence.
 * Stored separately so it can be written to an external durable store
 * (e.g. S3, blockchain) without blocking the write path.
 */
@Entity('audit_chain_checkpoints')
@Index('idx_acc_sequence', ['upToSequence'])
export class AuditChainCheckpointEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The highest sequence number included in this checkpoint */
  @Column({ name: 'up_to_sequence', type: 'bigint' })
  upToSequence: number;

  /** Cumulative root hash of all entries up to upToSequence */
  @Column({ name: 'root_hash', type: 'varchar', length: 64 })
  rootHash: string;

  /** Optional external reference (e.g. S3 object key, blockchain tx id) */
  @Column({ name: 'external_ref', type: 'varchar', length: 512, nullable: true })
  externalRef: string | null;

  @CreateDateColumn({ name: 'anchored_at' })
  anchoredAt: Date;
}
