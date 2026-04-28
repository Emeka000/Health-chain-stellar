import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

export enum FileOwnerType {
  DELIVERY_PROOF = 'delivery_proof',
  PROOF_BUNDLE = 'proof_bundle',
  BATCH_IMPORT = 'batch_import',
}

export enum FileLifecycleStatus {
  ACTIVE = 'active',
  SUPERSEDED = 'superseded',
  ORPHANED = 'orphaned',
  DELETED = 'deleted',
}

@Entity('file_metadata')
@Index('idx_file_metadata_owner', ['ownerType', 'ownerId'])
@Index('idx_file_metadata_status', ['status'])
export class FileMetadataEntity extends BaseEntity {
  // ── Immutable fields (set at creation, never modified) ──────────────

  @Column({ name: 'owner_type', type: 'varchar', length: 64 })
  ownerType: FileOwnerType;

  @Column({ name: 'owner_id', type: 'varchar', length: 64 })
  ownerId: string;

  @Column({ name: 'storage_path', type: 'varchar', length: 512 })
  storagePath: string;

  @Column({ name: 'original_filename', type: 'varchar', length: 255, nullable: true })
  originalFilename: string | null;

  @Column({ name: 'content_type', type: 'varchar', length: 128, nullable: true })
  contentType: string | null;

  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes: number | null;

  /** SHA-256 digest of the file content — immutable after creation */
  @Column({ name: 'sha256_hash', type: 'varchar', length: 64, nullable: true })
  sha256Hash: string | null;

  // ── Mutable policy-controlled fields ────────────────────────────────

  @Column({ name: 'status', type: 'varchar', length: 32, default: FileLifecycleStatus.ACTIVE })
  status: FileLifecycleStatus;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  /** Current mutable version number (incremented on each policy update) */
  @Column({ name: 'metadata_version', type: 'int', default: 1 })
  metadataVersion: number;

  /** Retention expiry date — file may be GC'd after this date unless on legal hold */
  @Column({ name: 'retention_expires_at', type: 'timestamptz', nullable: true })
  retentionExpiresAt: Date | null;

  /** Legal hold prevents deletion regardless of retention policy */
  @Column({ name: 'legal_hold', type: 'boolean', default: false })
  legalHold: boolean;

  /** Actor who placed the legal hold */
  @Column({ name: 'legal_hold_by', type: 'varchar', length: 255, nullable: true })
  legalHoldBy: string | null;

  /** Reason for the legal hold */
  @Column({ name: 'legal_hold_reason', type: 'text', nullable: true })
  legalHoldReason: string | null;
}

