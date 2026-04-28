import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';

import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';

import { UserEntity } from '../../users/entities/user.entity';
import { TwoFactorAuthEntity } from '../../users/entities/two-factor-auth.entity';
import { JwtKeyService } from '../jwt-key.service';
import { JwtPayload } from '../jwt.strategy';
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from './totp.util';

const CIPHER_ALGO = 'aes-256-gcm';
const IV_LEN = 12;

@Injectable()
export class MfaService {
  private readonly encryptionKey: Uint8Array;
  private readonly issuer: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly jwtKeyService: JwtKeyService,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(TwoFactorAuthEntity)
    private readonly tfaRepo: Repository<TwoFactorAuthEntity>,
  ) {
    // Derive a 32-byte AES key from JWT_SECRET so no extra env var is needed.
    const masterSecret = this.configService.get<string>('JWT_SECRET', 'default-secret');
    // Use a fixed salt derived from the master secret itself for determinism
    const salt = scryptSync('mfa-key-salt', masterSecret, 16) as Uint8Array;
    this.encryptionKey = scryptSync(masterSecret, salt, 32) as Uint8Array;
    this.issuer = this.configService.get<string>('APP_NAME', 'HealthChain');
  }

  // ── Encryption helpers ────────────────────────────────────────────────────

  private encryptSecret(plaintext: string): string {
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(CIPHER_ALGO, this.encryptionKey, iv);
    const enc1 = cipher.update(plaintext, 'utf8', 'hex');
    const enc2 = cipher.final('hex');
    const tag = cipher.getAuthTag();
    // Format: iv:tag:ciphertext (all hex)
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc1}${enc2}`;
  }

  private decryptSecret(stored: string): string {
    const parts = stored.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted secret format');
    const [ivHex, tagHex, ctHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = createDecipheriv(CIPHER_ALGO, this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return decipher.update(ctHex, 'hex', 'utf8') + decipher.final('utf8');
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  /**
   * Generate a new TOTP secret for the user and return the otpauth URI + QR
   * code data URL. The secret is stored encrypted but MFA is NOT yet enabled —
   * the caller must call `verifyAndEnable` to activate it.
   */
  async setupMfa(userId: string): Promise<{ qrCodeDataUrl: string }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const plainSecret = generateTotpSecret();
    const encryptedSecret = this.encryptSecret(plainSecret);

    // Upsert the TwoFactorAuthEntity
    let tfa = await this.tfaRepo.findOne({ where: { userId } });
    if (!tfa) {
      tfa = this.tfaRepo.create({ userId, isEnabled: false });
    }
    tfa.secret = encryptedSecret;
    tfa.isEnabled = false; // not active until verified
    await this.tfaRepo.save(tfa);

    const uri = buildOtpAuthUri(plainSecret, user.email, this.issuer);
    const qrCodeDataUrl = await QRCode.toDataURL(uri);

    // Return QR code only — the plaintext secret is never sent over the wire
    return { qrCodeDataUrl };
  }

  /**
   * Verify a TOTP code and enable MFA for the user.
   * Returns a short-lived MFA confirmation token.
   */
  async verifyAndEnable(userId: string, token: string): Promise<{ mfaToken: string }> {
    const tfa = await this.tfaRepo.findOne({ where: { userId } });
    if (!tfa?.secret) {
      throw new BadRequestException('MFA setup not initiated. Call /auth/mfa/setup first.');
    }

    const plainSecret = this.decryptSecret(tfa.secret);
    if (!verifyTotp(plainSecret, token)) {
      throw new UnauthorizedException('Invalid or expired TOTP code');
    }

    tfa.isEnabled = true;
    await this.tfaRepo.save(tfa);

    return { mfaToken: this.issueMfaToken(userId) };
  }

  /**
   * Validate a TOTP code for an already-enabled MFA user.
   * Returns a short-lived MFA token that the login flow exchanges for a full JWT.
   */
  async validateMfaCode(userId: string, token: string): Promise<{ mfaToken: string }> {
    const tfa = await this.tfaRepo.findOne({ where: { userId } });
    if (!tfa?.isEnabled || !tfa.secret) {
      throw new BadRequestException('MFA is not enabled for this account');
    }

    const plainSecret = this.decryptSecret(tfa.secret);
    if (!verifyTotp(plainSecret, token)) {
      throw new UnauthorizedException('Invalid or expired TOTP code');
    }

    return { mfaToken: this.issueMfaToken(userId) };
  }

  /**
   * Disable MFA after confirming with a valid TOTP code.
   */
  async disableMfa(userId: string, token: string): Promise<{ message: string }> {
    const tfa = await this.tfaRepo.findOne({ where: { userId } });
    if (!tfa?.isEnabled || !tfa.secret) {
      throw new BadRequestException('MFA is not enabled for this account');
    }

    const plainSecret = this.decryptSecret(tfa.secret);
    if (!verifyTotp(plainSecret, token)) {
      throw new UnauthorizedException('Invalid or expired TOTP code');
    }

    tfa.isEnabled = false;
    tfa.secret = null;
    await this.tfaRepo.save(tfa);

    return { message: 'MFA disabled successfully' };
  }

  /**
   * Returns true if the user has MFA enabled.
   */
  async isMfaEnabled(userId: string): Promise<boolean> {
    const tfa = await this.tfaRepo.findOne({ where: { userId } });
    return tfa?.isEnabled ?? false;
  }

  /**
   * Verify an MFA token (used by the login flow to exchange for a full JWT).
   * Returns the userId encoded in the token.
   */
  verifyMfaToken(mfaToken: string): string {
    try {
      const payload = this.jwtService.verify<{ sub: string; purpose: string }>(
        mfaToken,
        {
          secret: this.configService.get<string>('JWT_SECRET', 'default-secret'),
        },
      );
      if (payload.purpose !== 'mfa') {
        throw new UnauthorizedException('Invalid MFA token');
      }
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private issueMfaToken(userId: string): string {
    const { kid, secret } = this.jwtKeyService.getActiveKey();
    return this.jwtService.sign(
      { sub: userId, purpose: 'mfa' },
      { secret, keyid: kid, expiresIn: '5m' },
    );
  }
}
