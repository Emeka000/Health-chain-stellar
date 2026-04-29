import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

/**
 * Access classification for uploaded artifacts.
 * PUBLIC  – freely accessible (static serving is fine).
 * INTERNAL – authenticated users only; served via backend proxy.
 * PROTECTED – sensitive proof/evidence; requires signed URL or authenticated endpoint.
 */
export enum ArtifactAccessClass {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  PROTECTED = 'protected',
}

const PROTECTED_SUBFOLDERS = new Set(['proof', 'evidence', 'profile']);
const INTERNAL_SUBFOLDERS = new Set(['batch-import', 'reports']);

export function resolveAccessClass(subfolder: string): ArtifactAccessClass {
  if (PROTECTED_SUBFOLDERS.has(subfolder)) return ArtifactAccessClass.PROTECTED;
  if (INTERNAL_SUBFOLDERS.has(subfolder)) return ArtifactAccessClass.INTERNAL;
  return ArtifactAccessClass.PUBLIC;
}

export interface StorageResult {
  url: string;
  key: string;
  bucket: string;
  accessClass: ArtifactAccessClass;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storageType: 'local' | 's3';
  private readonly uploadDir: string;
  private readonly s3Client: S3Client | null;
  private readonly s3Bucket: string;
  private readonly s3Region: string;
  private readonly localSignSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.storageType = this.configService.get<string>(
      'STORAGE_TYPE',
      'local',
    ) as 'local' | 's3';
    this.uploadDir = this.configService.get<string>('UPLOAD_DIR', './uploads');
    this.s3Bucket = this.configService.get<string>('S3_BUCKET', '');
    this.s3Region = this.configService.get<string>('AWS_REGION', 'us-east-1');
    this.localSignSecret = this.configService.get<string>(
      'LOCAL_SIGN_SECRET',
      'change-me-in-production',
    );

    if (this.storageType === 's3') {
      if (!this.s3Bucket) {
        throw new InternalServerErrorException(
          'S3_BUCKET must be configured when STORAGE_TYPE=s3',
        );
      }
      this.s3Client = new S3Client({
        region: this.s3Region,
        ...(this.configService.get<string>('AWS_ENDPOINT')
          ? { endpoint: this.configService.get<string>('AWS_ENDPOINT') }
          : {}),
      });
    } else {
      this.s3Client = null;
    }
  }

  async uploadFile(
    file: Buffer,
    originalName: string,
    mimeType: string,
    subfolder: string,
  ): Promise<StorageResult> {
    const fileExtension = path.extname(originalName);
    const fileName = `${uuidv4()}${fileExtension}`;
    const key = `${subfolder}/${fileName}`;
    const accessClass = resolveAccessClass(subfolder);

    if (this.storageType === 'local') {
      return this.uploadToLocal(file, key, subfolder, accessClass);
    }
    return this.uploadToS3(file, key, mimeType, accessClass);
  }

  private async uploadToLocal(
    file: Buffer,
    key: string,
    subfolder: string,
    accessClass: ArtifactAccessClass,
  ): Promise<StorageResult> {
    const uploadPath = path.join(this.uploadDir, subfolder);
    await fs.mkdir(uploadPath, { recursive: true });

    const filePath = path.join(uploadPath, path.basename(key));
    await fs.writeFile(filePath, file);

    // Non-public artifacts must not be served via predictable static paths.
    const url =
      accessClass === ArtifactAccessClass.PUBLIC
        ? `/uploads/${key}`
        : `/files/download?key=${encodeURIComponent(key)}`;

    return { url, key, bucket: 'local', accessClass };
  }

  private async uploadToS3(
    file: Buffer,
    key: string,
    mimeType: string,
    accessClass: ArtifactAccessClass,
  ): Promise<StorageResult> {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.s3Client!.send(
          new PutObjectCommand({
            Bucket: this.s3Bucket,
            Key: key,
            Body: file,
            ContentType: mimeType,
          }),
        );
        // Non-public S3 objects are served through the backend download endpoint
        // (which issues a short-lived pre-signed redirect), not via a direct URL.
        const url =
          accessClass === ArtifactAccessClass.PUBLIC
            ? `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${key}`
            : `/files/download?key=${encodeURIComponent(key)}`;
        return { url, key, bucket: this.s3Bucket, accessClass };
      } catch (error) {
        lastError = error;
        this.logger.warn(`S3 upload attempt ${attempt}/${maxAttempts} failed: ${(error as Error).message}`);
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        }
      }
    }

    throw new InternalServerErrorException(
      `S3 upload failed after ${maxAttempts} attempts: ${(lastError as Error).message}`,
    );
  }

  async deleteFile(key: string, bucket?: string): Promise<void> {
    if (this.storageType === 'local') {
      const filePath = path.join(this.uploadDir, key);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        this.logger.warn(`Failed to delete local file: ${filePath}`, error);
      }
      return;
    }

    const targetBucket = bucket ?? this.s3Bucket;
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.s3Client!.send(
          new DeleteObjectCommand({ Bucket: targetBucket, Key: key }),
        );
        return;
      } catch (error) {
        lastError = error;
        this.logger.warn(`S3 delete attempt ${attempt}/${maxAttempts} failed: ${(error as Error).message}`);
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
        }
      }
    }

    throw new InternalServerErrorException(
      `S3 delete failed after ${maxAttempts} attempts: ${(lastError as Error).message}`,
    );
  }

  /**
   * Returns a download URL appropriate for the artifact's access class.
   * PUBLIC  → direct URL (local static path or S3 public URL).
   * INTERNAL/PROTECTED → backend download endpoint URL.
   */
  getDownloadUrl(key: string): string {
    const subfolder = key.split('/')[0];
    const accessClass = resolveAccessClass(subfolder);
    if (accessClass === ArtifactAccessClass.PUBLIC) {
      return this.storageType === 'local'
        ? `/uploads/${key}`
        : `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${key}`;
    }
    return `/files/download?key=${encodeURIComponent(key)}`;
  }

  /** @deprecated Use getDownloadUrl() for access-class-aware URL resolution. */
  getFileUrl(key: string): string {
    return this.getDownloadUrl(key);
  }

  /**
   * S3: returns a pre-signed URL valid for expiresInSeconds.
   * Local: returns an HMAC-signed token URL routed through the download endpoint.
   */
  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (this.storageType === 's3') {
      const command = new GetObjectCommand({ Bucket: this.s3Bucket, Key: key });
      return getSignedUrl(this.s3Client!, command, { expiresIn: expiresInSeconds });
    }
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const sig = this.signLocalToken(key, expiresAt);
    return `/files/download?key=${encodeURIComponent(key)}&exp=${expiresAt}&sig=${sig}`;
  }

  /** Verifies a local signed-token. Returns true if valid and not expired. */
  verifyLocalToken(key: string, exp: number, sig: string): boolean {
    if (Math.floor(Date.now() / 1000) > exp) return false;
    const expected = this.signLocalToken(key, exp);
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch {
      return false;
    }
  }

  private signLocalToken(key: string, exp: number): string {
    return crypto
      .createHmac('sha256', this.localSignSecret)
      .update(`${key}:${exp}`)
      .digest('hex');
  }
}
