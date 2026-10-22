import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from 'crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';

import Redis from 'ioredis';
import * as QRCode from 'qrcode';
import { Repository } from 'typeorm';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import { UserEntity } from '../../users/entities/user.entity';
import { TwoFactorAuthEntity } from '../../users/entities/two-factor-auth.entity';
import { JwtKeyService } from '../jwt-key.service';
import { MFA_TOKEN_AUDIENCE } from './mfa.constants';
import { buildOtpAuthUri, generateTotpSecret, verifyTotp } from './totp.util';

const CIPHER_ALGO = 'aes-256-gcm';
const IV_LEN = 12;

const MFA_TTL_SECONDS = 5 * 60;
const MAX_CHALLENGE_ATTEMPTS = 5;
// verifyTotp accepts ±1 step of 30s, so a code stays valid for up to 90s
const USED_CODE_TTL_SECONDS = 90;

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
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    // Derive a 32-byte AES key from JWT_SECRET so no extra env var is needed.
    const masterSecret = this.configService.getOrThrow<string>('JWT_SECRET');
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
    if (tfa?.isEnabled) {
      // Re-running setup would silently disable MFA without TOTP proof
      throw new ConflictException(
        'MFA is already enabled. Disable it with a valid TOTP code first.',
      );
    }
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

    return { mfaToken: await this.issueMfaToken(userId) };
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

    return { mfaToken: await this.issueMfaToken(userId) };
  }

  /**
   * Issue a short-lived, single-use challenge proving the password step
   * succeeded. Called by AuthService.login() when MFA is enabled.
   */
  async createLoginChallenge(userId: string): Promise<string> {
    const challenge = randomBytes(32).toString('hex');
    await this.redis.set(
      this.challengeKey(challenge),
      userId,
      'EX',
      MFA_TTL_SECONDS,
    );
    return challenge;
  }

  /**
   * Complete the MFA login step: requires the password-verified challenge
   * from login() plus a valid, not-yet-used TOTP code.
   */
  async validateLoginChallenge(
    userId: string,
    challenge: string,
    token: string,
  ): Promise<{ mfaToken: string }> {
    const challengeKey = this.challengeKey(challenge);
    const attemptsKey = `${challengeKey}:attempts`;

    const challengeUserId = await this.redis.get(challengeKey);
    if (!challengeUserId || challengeUserId !== userId) {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }

    const tfa = await this.tfaRepo.findOne({ where: { userId } });
    if (!tfa?.isEnabled || !tfa.secret) {
      throw new BadRequestException('MFA is not enabled for this account');
    }

    const plainSecret = this.decryptSecret(tfa.secret);
    if (!verifyTotp(plainSecret, token)) {
      const attempts = await this.redis.incr(attemptsKey);
      await this.redis.expire(attemptsKey, MFA_TTL_SECONDS);
      if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
        await this.redis.del(challengeKey, attemptsKey);
      }
      throw new UnauthorizedException('Invalid or expired TOTP code');
    }

    const codeUnused = await this.redis.set(
      `auth:mfa-used-code:${userId}:${token}`,
      '1',
      'EX',
      USED_CODE_TTL_SECONDS,
      'NX',
    );
    if (!codeUnused) {
      throw new UnauthorizedException('TOTP code has already been used');
    }

    // Single use: only the caller that deletes the challenge may proceed
    const consumed = await this.redis.del(challengeKey);
    if (consumed !== 1) {
      throw new UnauthorizedException('Invalid or expired MFA challenge');
    }
    await this.redis.del(attemptsKey);

    return { mfaToken: await this.issueMfaToken(userId) };
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
   * Verify and consume an MFA token (used by the login flow to exchange for a
   * full JWT). Each token can be exchanged once. Returns the userId.
   */
  async verifyMfaToken(mfaToken: string): Promise<string> {
    let payload: { sub: string; purpose: string; jti?: string };
    try {
      payload = this.jwtService.verify<{
        sub: string;
        purpose: string;
        jti?: string;
      }>(mfaToken, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        audience: MFA_TOKEN_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA token');
    }

    if (payload.purpose !== 'mfa' || !payload.jti) {
      throw new UnauthorizedException('Invalid MFA token');
    }

    const consumed = await this.redis.del(this.mfaTokenKey(payload.jti));
    if (consumed !== 1) {
      throw new UnauthorizedException('MFA token has already been used');
    }
    return payload.sub;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async issueMfaToken(userId: string): Promise<string> {
    const { kid, secret } = this.jwtKeyService.getActiveKey();
    const jti = randomBytes(16).toString('hex');
    await this.redis.set(
      this.mfaTokenKey(jti),
      userId,
      'EX',
      MFA_TTL_SECONDS,
    );
    // Distinct audience so JwtStrategy never accepts this as an access token
    return this.jwtService.sign(
      { sub: userId, purpose: 'mfa', jti },
      {
        secret,
        keyid: kid,
        expiresIn: MFA_TTL_SECONDS,
        audience: MFA_TOKEN_AUDIENCE,
      },
    );
  }

  private challengeKey(challenge: string): string {
    const hash = createHash('sha256').update(challenge).digest('hex');
    return `auth:mfa-challenge:${hash}`;
  }

  private mfaTokenKey(jti: string): string {
    return `auth:mfa-token:${jti}`;
  }
}
