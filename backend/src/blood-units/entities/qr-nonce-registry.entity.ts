import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum QrNonceStatus {
  UNUSED = 'UNUSED',
  CONSUMED = 'CONSUMED',
  EXPIRED = 'EXPIRED',
}

@Entity('qr_nonce_registry')
@Index(['nonce'], { unique: true })
@Index(['expiresAt'])
export class QrNonceRegistryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Cryptographically random nonce embedded in the QR payload */
  @Column({ type: 'varchar', length: 64, unique: true })
  nonce: string;

  @Column({ name: 'unit_number', type: 'varchar' })
  unitNumber: string;

  @Column({
    type: 'simple-enum',
    enum: QrNonceStatus,
    default: QrNonceStatus.UNUSED,
  })
  status: QrNonceStatus;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @Column({ name: 'consumed_by', type: 'varchar', nullable: true })
  consumedBy: string | null;

  /** Whether this nonce was issued for offline use */
  @Column({ name: 'offline_mode', default: false })
  offlineMode: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
