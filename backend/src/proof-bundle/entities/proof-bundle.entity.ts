import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ProofBundleStatus {
  PENDING = 'pending',
  VALIDATED = 'validated',
  REJECTED = 'rejected',
}

/** A single artifact entry in the canonical manifest */
export interface ManifestArtifact {
  /** Artifact type identifier (e.g. 'signature', 'photo', 'medical', 'delivery') */
  type: string;
  /** SHA-256 hex digest of the artifact content */
  digest: string;
  /** Sequence position (0-based) for ordering validation */
  seq: number;
}

@Entity('proof_bundles')
export class ProofBundleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'payment_id' })
  paymentId: string;

  @Column({ name: 'delivery_proof_id' })
  deliveryProofId: string;

  /** SHA-256 hex of the delivery proof record */
  @Column({ name: 'delivery_hash', length: 64 })
  deliveryHash: string;

  /** SHA-256 hex of the recipient signature artifact */
  @Column({ name: 'signature_hash', length: 64 })
  signatureHash: string;

  /** SHA-256 hex of the photo evidence */
  @Column({ name: 'photo_hash', length: 64 })
  photoHash: string;

  /** SHA-256 hex of the medical verification record */
  @Column({ name: 'medical_hash', length: 64 })
  medicalHash: string;

  @Column({ name: 'submitted_by' })
  submittedBy: string;

  @Column({
    type: 'enum',
    enum: ProofBundleStatus,
    default: ProofBundleStatus.PENDING,
  })
  status: ProofBundleStatus;

  /** Human-readable reason when status is REJECTED */
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  /** Timestamp when escrow was released using this bundle */
  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  /** Ordered artifact manifest for chain-of-evidence */
  @Column({ name: 'manifest', type: 'jsonb', nullable: true })
  manifest: ManifestArtifact[] | null;

  /** SHA-256 root digest of the canonical manifest (deterministic) */
  @Column({ name: 'manifest_root_digest', length: 64, nullable: true })
  manifestRootDigest: string | null;

  /** Identity of the authorized evidence submitter who signed the bundle */
  @Column({ name: 'verifier_identity', type: 'varchar', length: 255, nullable: true })
  verifierIdentity: string | null;

  /** Verification report produced by the validation pipeline */
  @Column({ name: 'verification_report', type: 'jsonb', nullable: true })
  verificationReport: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
