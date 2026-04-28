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

export interface StorageResult {
  url: string;
  key: string;
  bucket: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storageType: 'local' | 's3';
  private readonly uploadDir: string;
  private readonly s3Client: S3Client | null;
  private readonly s3Bucket: string;
  private readonly s3Region: string;

  constructor(private readonly configService: ConfigService) {
    this.storageType = this.configService.get<string>(
      'STORAGE_TYPE',
      'local',
    ) as 'local' | 's3';
    this.uploadDir = this.configService.get<string>('UPLOAD_DIR', './uploads');
    this.s3Bucket = this.configService.get<string>('S3_BUCKET', '');
    this.s3Region = this.configService.get<string>('AWS_REGION', 'us-east-1');

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

    if (this.storageType === 'local') {
      return this.uploadToLocal(file, key, subfolder);
    }
    return this.uploadToS3(file, key, mimeType);
  }

  private async uploadToLocal(
    file: Buffer,
    key: string,
    subfolder: string,
  ): Promise<StorageResult> {
    const uploadPath = path.join(this.uploadDir, subfolder);
    await fs.mkdir(uploadPath, { recursive: true });

    const filePath = path.join(uploadPath, path.basename(key));
    await fs.writeFile(filePath, file);

    return { url: `/uploads/${key}`, key, bucket: 'local' };
  }

  private async uploadToS3(
    file: Buffer,
    key: string,
    mimeType: string,
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
        const url = `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${key}`;
        return { url, key, bucket: this.s3Bucket };
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

  getFileUrl(key: string): string {
    if (this.storageType === 'local') {
      return `/uploads/${key}`;
    }
    return `https://${this.s3Bucket}.s3.${this.s3Region}.amazonaws.com/${key}`;
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    if (this.storageType === 'local') {
      return `/uploads/${key}`;
    }
    const command = new GetObjectCommand({ Bucket: this.s3Bucket, Key: key });
    return getSignedUrl(this.s3Client!, command, { expiresIn: expiresInSeconds });
  }
}
