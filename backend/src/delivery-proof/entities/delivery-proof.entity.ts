import { Column, Entity } from 'typeorm';

import { BaseEntity } from '../../common/entities/base.entity';

// Blood products must be stored between 2°C and 8°C (per issue #178 spec)
const TEMP_MIN_CELSIUS = 2;
const TEMP_MAX_CELSIUS = 8;

@Entity('delivery_proofs')
export class DeliveryProofEntity extends BaseEntity {
  @Column({ name: 'delivery_id', type: 'bigint' })
  deliveryId: number;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column({ name: 'request_id', nullable: true, type: 'varchar' })
  requestId: string | null;

  @Column({ name: 'rider_id' })
  riderId: string;

  @Column({ name: 'pickup_timestamp', type: 'timestamptz' })
  pickupTimestamp: Date;

  @Column({ name: 'pickup_location_hash', type: 'varchar', length: 64, nullable: true })
  pickupLocationHash: string | null;

  @Column({ name: 'delivered_at', type: 'timestamptz' })
  deliveredAt: Date;

  @Column({ name: 'delivery_location_hash', type: 'varchar', length: 64, nullable: true })
  deliveryLocationHash: string | null;

  @Column({ name: 'recipient_name' })
  recipientName: string;

  @Column({ name: 'recipient_signature_url', nullable: true, type: 'varchar' })
  recipientSignatureUrl: string | null;

  @Column({ name: 'recipient_signature_hash', type: 'varchar', length: 64, nullable: true })
  recipientSignatureHash: string | null;

  @Column({ name: 'photo_url', nullable: true, type: 'varchar' })
  photoUrl: string | null;

  /** Array of photo content hashes for tamper-evidence */
  @Column({ name: 'photo_hashes', type: 'jsonb', default: [] })
  photoHashes: string[];

  /** Temperature readings (°C) recorded during transit */
  @Column({ name: 'temperature_readings', type: 'jsonb', default: [] })
  temperatureReadings: number[];

  @Column({ name: 'temperature_celsius', type: 'float', nullable: true })
  temperatureCelsius: number | null;

  @Column({ name: 'notes', type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'is_temperature_compliant', default: true })
  isTemperatureCompliant: boolean;

  @Column({ name: 'verified', default: false })
  verified: boolean;

  @Column({ name: 'blockchain_tx_hash', type: 'varchar', length: 128, nullable: true })
  blockchainTxHash: string | null;

  @Column({ name: 'signer_key_id', type: 'varchar', length: 64, nullable: true })
  signerKeyId: string | null;

  @Column({ name: 'signer_public_key', type: 'varchar', length: 56, nullable: true })
  signerPublicKey: string | null;

  @Column({ name: 'signer_role', type: 'varchar', length: 32, nullable: true })
  signerRole: string | null;

  @Column({ name: 'signed_at', type: 'timestamptz', nullable: true })
  signedAt: Date | null;

  @Column({ name: 'proof_signature', type: 'text', nullable: true })
  proofSignature: string | null;

  @Column({ name: 'proof_payload_digest', type: 'varchar', length: 64, nullable: true })
  proofPayloadDigest: string | null;

  @Column({ name: 'trusted_timestamp_at', type: 'timestamptz', nullable: true })
  trustedTimestampAt: Date | null;

  @Column({ name: 'timestamp_anchor_hash', type: 'varchar', length: 64, nullable: true })
  timestampAnchorHash: string | null;

  @Column({ name: 'evidence_digest_references', type: 'jsonb', default: [] })
  evidenceDigestReferences: string[];


  // ─── Validation helpers ───────────────────────────────────────────────────

  validate(): void {
    if (this.deliveredAt < this.pickupTimestamp) {
      throw new Error('InvalidTimestamp: deliveredAt must be after pickupTimestamp');
    }
    if (!this.temperatureReadings || this.temperatureReadings.length === 0) {
      throw new Error('MissingTemperatureData: at least one temperature reading is required');
    }
  }

  withinTemperatureRange(): boolean {
    if (!this.temperatureReadings || this.temperatureReadings.length === 0) {
      return false;
    }
    return this.temperatureReadings.every(
      (t) => t >= TEMP_MIN_CELSIUS && t <= TEMP_MAX_CELSIUS,
    );
  }
}
