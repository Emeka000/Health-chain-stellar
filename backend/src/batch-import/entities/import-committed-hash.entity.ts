import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';

import { ImportEntityType } from '../enums/import.enum';

/**
 * Stores the SHA-256 hash of every successfully committed row.
 * Used for cross-batch idempotent deduplication: if the same row
 * is submitted in a future batch, it is marked DUPLICATE without
 * re-inserting the domain record.
 */
@Entity('import_committed_hashes')
@Index('IDX_COMMITTED_HASH_VALUE', ['rowHash', 'entityType'], { unique: true })
export class ImportCommittedHashEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'row_hash', type: 'varchar', length: 64 })
    rowHash: string;

    @Column({ name: 'entity_type', type: 'varchar', length: 32 })
    entityType: ImportEntityType;

    /** The domain record ID that was created for this row. */
    @Column({ name: 'committed_id', type: 'varchar', length: 64 })
    committedId: string;

    /** Batch that first committed this row. */
    @Column({ name: 'batch_id', type: 'uuid' })
    batchId: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;
}
