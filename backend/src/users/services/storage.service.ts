import * as fs from 'fs/promises';
import * as path from 'path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  constructor(private readonly configService: ConfigService) {
    this.storageType = this.configService.get<string>(
      'STORAGE_TYPE',
      'local',
    ) as 'local' | 's3';
    this.uploadDir = this.configService.get<string>('UPLOAD_DIR', './uploads');
  }

  async uploadFile(
    file: Buffer,
    originalName: string,
    mimeType: string,
    subfolder: string = 'avatars',
  ): Promise<StorageResult> {
    const fileExtension = path.extname(originalName);
    const fileName = `${uuidv4()}${fileExtension}`;
    const key = `${subfolder}/${fileName}`;

    if (this.storageType === 'local') {
      return this.uploadToLocal(file, key, subfolder);
    } else {
      return this.uploadToS3(file, key, mimeType);
    }
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

    const url = `/uploads/${key}`;
    return {
      url,
      key,
      bucket: 'local',
    };
  }

  private async uploadToS3(
    file: Buffer,
    key: string,
    mimeType: string,
  ): Promise<StorageResult> {
    // S3 implementation would go here
    // For now, we'll use local storage as fallback
    this.logger.warn(
      'S3 storage not implemented, falling back to local storage',
    );
    return this.uploadToLocal(file, key, 'avatars');
  }

  async deleteFile(key: string, bucket: string = 'local'): Promise<void> {
    if (this.storageType === 'local' || bucket === 'local') {
      const filePath = path.join(this.uploadDir, key);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        this.logger.warn(`Failed to delete file: ${filePath}`, error);
      }
    } else {
      // S3 deletion would go here
      this.logger.warn('S3 deletion not implemented');
    }
  }

  getFileUrl(key: string): string {
    if (this.storageType === 'local') {
      return `/uploads/${key}`;
    }
    // S3 URL would go here
    return `/uploads/${key}`;
  }
}
