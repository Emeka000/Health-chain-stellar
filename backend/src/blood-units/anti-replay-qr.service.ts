import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';

import { BloodUnitEntity } from './entities/blood-unit.entity';
import { QrVerificationLogEntity, QrVerificationResult } from './entities/qr-verification-log.entity';
import { QrNonceRegistryEntity, QrNonceStatus } from './entities/qr-nonce-registry.entity';

/** TTL for online QR codes (minutes) */
const ONLINE_TTL_MINUTES = 15;
/** TTL for offline signed manifests (hours) */
const OFFLINE_TTL_HOURS = 8;

export interface SecureQrPayload {
  unitNumber: string;
  bloodType: string;
  bankId: string;
  nonce: string;
  expiresAt: string; // ISO-8601
  signature: string;
  offline?: boolean;
}

export interface QrVerificationResponse {
  verified: boolean;
  unitNumber: string;
  replayDetected?: boolean;
  offlineMode?: boolean;
}

@Injectable()
export class AntiReplayQrService {
  private readonly logger = new Logger(AntiReplayQrService.name);
  private readonly hmacSecret: string;

  constructor(
    @InjectRepository(BloodUnitEntity)
    private readonly bloodUnitRepo: Repository<BloodUnitEntity>,
    @InjectRepository(QrVerificationLogEntity)
    private readonly logRepo: Repository<QrVerificationLogEntity>,
    @InjectRepository(QrNonceRegistryEntity)
    private readonly nonceRepo: Repository<QrNonceRegistryEntity>,
    private readonly configService: ConfigService,
  ) {
    this.hmacSecret = this.configService.get<string>('QR_HMAC_SECRET', 'change-me-in-production');
  }

  /**
   * Issues a new secure QR payload for a blood unit.
   * Registers the nonce in the one-time token registry.
   */
  async issueQrPayload(unitNumber: string, offline = false): Promise<SecureQrPayload> {
    const unit = await this.bloodUnitRepo.findOne({ where: { unitNumber } });
    if (!unit) throw new NotFoundException(`Blood unit ${unitNumber} not found`);

    const nonce = randomBytes(32).toString('hex');
    const ttlMs = offline
      ? OFFLINE_TTL_HOURS * 60 * 60 * 1000
      : ONLINE_TTL_MINUTES * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);

    const payload: Omit<SecureQrPayload, 'signature'> = {
      unitNumber,
      bloodType: unit.bloodType,
      bankId: unit.bankId ?? '',
      nonce,
      expiresAt: expiresAt.toISOString(),
      offline,
    };

    const signature = this.sign(payload);

    // Register nonce
    await this.nonceRepo.save(
      this.nonceRepo.create({
        nonce,
        unitNumber,
        expiresAt,
        offlineMode: offline,
        status: QrNonceStatus.UNUSED,
      }),
    );

    return { ...payload, signature };
  }

  /**
   * Verifies a scanned QR payload with full anti-replay protection.
   * Handles both online and offline (signed manifest) modes.
   */
  async verify(
    rawPayload: string,
    scannedBy: string,
    orderId: string,
  ): Promise<QrVerificationResponse> {
    let payload: SecureQrPayload;
    try {
      payload = JSON.parse(rawPayload) as SecureQrPayload;
    } catch {
      throw new BadRequestException('Invalid QR payload format');
    }

    // 1. Verify signature
    const { signature, ...payloadWithoutSig } = payload;
    const expectedSig = this.sign(payloadWithoutSig);
    if (!this.safeCompare(signature, expectedSig)) {
      await this.logResult(payload.unitNumber, orderId, scannedBy, QrVerificationResult.MISMATCH, 'Invalid signature');
      throw new UnauthorizedException('QR signature invalid');
    }

    // 2. Check expiry
    const expiresAt = new Date(payload.expiresAt);
    if (expiresAt < new Date()) {
      await this.logResult(payload.unitNumber, orderId, scannedBy, QrVerificationResult.MISMATCH, 'QR code expired');
      throw new BadRequestException('QR code has expired');
    }

    // 3. Replay detection via nonce registry
    const nonceRecord = await this.nonceRepo.findOne({ where: { nonce: payload.nonce } });

    if (!nonceRecord) {
      // Nonce not in registry — could be a forged or unknown token
      await this.logResult(payload.unitNumber, orderId, scannedBy, QrVerificationResult.MISMATCH, 'Unknown nonce');
      throw new UnauthorizedException('QR nonce not recognized');
    }

    if (nonceRecord.status === QrNonceStatus.CONSUMED) {
      this.logger.warn(`Replay attack detected: nonce=${payload.nonce} unit=${payload.unitNumber}`);
      await this.logResult(payload.unitNumber, orderId, scannedBy, QrVerificationResult.MISMATCH, 'Replay detected');
      return { verified: false, unitNumber: payload.unitNumber, replayDetected: true };
    }

    if (nonceRecord.status === QrNonceStatus.EXPIRED || nonceRecord.expiresAt < new Date()) {
      await this.logResult(payload.unitNumber, orderId, scannedBy, QrVerificationResult.MISMATCH, 'Nonce expired');
      throw new BadRequestException('QR nonce has expired');
    }

    // 4. Consume nonce (one-time use)
    nonceRecord.status = QrNonceStatus.CONSUMED;
    nonceRecord.consumedAt = new Date();
    nonceRecord.consumedBy = scannedBy;
    await this.nonceRepo.save(nonceRecord);

    // 5. Verify unit exists
    const unit = await this.bloodUnitRepo.findOne({ where: { unitNumber: payload.unitNumber } });
    if (!unit) throw new NotFoundException(`Blood unit ${payload.unitNumber} not found`);

    await this.logResult(payload.unitNumber, orderId, scannedBy, QrVerificationResult.MATCH, null);

    this.logger.log(
      `QR verified: unit=${payload.unitNumber} order=${orderId} offline=${payload.offline ?? false}`,
    );

    return {
      verified: true,
      unitNumber: payload.unitNumber,
      replayDetected: false,
      offlineMode: payload.offline ?? false,
    };
  }

  /**
   * Cleans up expired nonces. Should be called periodically (e.g., via cron).
   */
  async cleanupExpiredNonces(): Promise<number> {
    const result = await this.nonceRepo.update(
      { status: QrNonceStatus.UNUSED, expiresAt: LessThan(new Date()) },
      { status: QrNonceStatus.EXPIRED },
    );
    return result.affected ?? 0;
  }

  private sign(payload: Omit<SecureQrPayload, 'signature'>): string {
    const data = JSON.stringify(payload, Object.keys(payload).sort());
    return createHmac('sha256', this.hmacSecret).update(data).digest('hex');
  }

  private safeCompare(a: string, b: string): boolean {
    try {
      return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
    } catch {
      return false;
    }
  }

  private async logResult(
    unitNumber: string,
    orderId: string,
    scannedBy: string,
    result: QrVerificationResult,
    failureReason: string | null,
  ): Promise<void> {
    await this.logRepo.save(
      this.logRepo.create({ unitNumber, orderId, scannedBy, result, failureReason }),
    );
  }
}
