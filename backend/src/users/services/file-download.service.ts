import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import { join, normalize, resolve, sep } from 'path';

/**
 * Result of verifying a signed download token.
 */
export interface SignedDownloadPayload {
  key: string;
  exp: number;
}

/**
 * Service responsible for issuing and verifying HMAC-signed download links
 * and for resolving the on-disk path of a requested file.
 *
 * Signed links look like:
 *   /files/download?key=<key>&exp=<unixSeconds>&sig=<hmac>
 * and are intended to work without a session (see FileDownloadController).
 */
@Injectable()
export class FileDownloadService {
  private readonly logger = new Logger(FileDownloadService.name);
  private readonly storageRoot: string;
  private readonly signingSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.storageRoot = resolve(
      this.configService.get<string>('STORAGE_ROOT') ?? join(process.cwd(), 'storage'),
    );
    this.signingSecret =
      this.configService.get<string>('FILE_DOWNLOAD_SECRET') ??
      this.configService.get<string>('JWT_SECRET') ??
      '';

    if (!this.signingSecret) {
      this.logger.warn(
        'No FILE_DOWNLOAD_SECRET or JWT_SECRET configured; signed download links cannot be verified',
      );
    }
  }

  /**
   * Create an HMAC signature for the given key and expiry.
   */
  sign(key: string, exp: number): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${key}:${exp}`)
      .digest('hex');
  }

  /**
   * Build a signed download URL for the given key.
   */
  createSignedUrl(key: string, ttlSeconds = 300): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.sign(key, exp);
    const params = new URLSearchParams({ key, exp: String(exp), sig });
    return `/files/download?${params.toString()}`;
  }

  /**
   * Verify a signed download token. Throws UnauthorizedException when the
   * signature is missing, malformed, tampered with, or expired.
   */
  verifySignedToken(key: string, exp: string | number, sig: string): SignedDownloadPayload {
    if (!key || !sig || exp === undefined || exp === null || exp === '') {
      throw new UnauthorizedException('Missing or invalid download token');
    }

    const expNumber = typeof exp === 'number' ? exp : Number(exp);
    if (!Number.isFinite(expNumber) || !Number.isInteger(expNumber)) {
      throw new UnauthorizedException('Invalid download token');
    }

    if (!this.signingSecret) {
      throw new UnauthorizedException('Download signing is not configured');
    }

    const expected = this.sign(key, expNumber);
    const provided = String(sig);

    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(provided, 'utf8');

    if (
      expectedBuf.length !== providedBuf.length ||
      !timingSafeEqual(expectedBuf, providedBuf)
    ) {
      throw new UnauthorizedException('Invalid download token');
    }

    if (expNumber <= Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException('Download link has expired');
    }

    return { key, exp: expNumber };
  }

  /**
   * Resolve a storage key to an absolute path, guarding against traversal.
   */
  resolvePath(key: string): string {
    const normalizedKey = normalize(key).replace(/^([/\\])+/, '');
    const absolute = resolve(this.storageRoot, normalizedKey);

    if (absolute !== this.storageRoot && !absolute.startsWith(this.storageRoot + sep)) {
      throw new UnauthorizedException('Invalid download key');
    }

    return absolute;
  }

  /**
   * Read a file from storage by key.
   */
  async readFile(key: string): Promise<Buffer> {
    const absolute = this.resolvePath(key);
    return fs.readFile(absolute);
  }

  /**
   * Verify a JWT and return its payload. Used by the authenticated download
   * route; the ACL check itself lives in the controller (#1162).
   */
  async verifyJwt(token: string): Promise<Record<string, unknown>> {
    try {
      return await this.jwtService.verifyAsync<Record<string, unknown>>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
