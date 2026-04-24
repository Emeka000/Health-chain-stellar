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

  @Column({ name: 'sha256_hash', type: 'varchar', length: 64, nullable: true })
  sha256Hash: string | null;

  @Column({ name: 'status', type: 'varchar', length: 32, default: FileLifecycleStatus.ACTIVE })
  status: FileLifecycleStatus;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
