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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
