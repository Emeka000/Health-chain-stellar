import { Injectable, BadRequestException } from '@nestjs/common';

import * as sharp from 'sharp';

export interface ImageValidationResult {
  isValid: boolean;
  width: number;
  height: number;
  format: string;
  size: number;
}

@Injectable()
export class ImageValidationService {
  private readonly allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
  ];

  private readonly maxFileSize = 5 * 1024 * 1024; // 5MB
  private readonly minWidth = 100;
  private readonly minHeight = 100;
  private readonly maxWidth = 4096;
  private readonly maxHeight = 4096;

  async validateImage(
    buffer: Buffer,
    mimeType: string,
    size: number,
  ): Promise<ImageValidationResult> {
    // Check MIME type
    if (!this.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(
        `Invalid file type. Allowed types: ${this.allowedMimeTypes.join(', ')}`,
      );
    }

    // Check file size
    if (size > this.maxFileSize) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${this.maxFileSize / (1024 * 1024)}MB`,
      );
    }

    // Get image metadata
    const metadata = await sharp(buffer).metadata();

    if (!metadata.width || !metadata.height) {
      throw new BadRequestException('Unable to determine image dimensions');
    }

    // Check dimensions
    if (metadata.width < this.minWidth || metadata.height < this.minHeight) {
      throw new BadRequestException(
        `Image dimensions must be at least ${this.minWidth}x${this.minHeight}px`,
      );
    }

    if (metadata.width > this.maxWidth || metadata.height > this.maxHeight) {
      throw new BadRequestException(
        `Image dimensions must not exceed ${this.maxWidth}x${this.maxHeight}px`,
      );
    }

    return {
      isValid: true,
      width: metadata.width,
      height: metadata.height,
      format: metadata.format || 'unknown',
      size,
    };
  }

  async resizeImage(
    buffer: Buffer,
    width: number = 200,
    height: number = 200,
  ): Promise<Buffer> {
    return sharp(buffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  async getImageDimensions(
    buffer: Buffer,
  ): Promise<{ width: number; height: number }> {
    const metadata = await sharp(buffer).metadata();
    return {
      width: metadata.width || 0,
      height: metadata.height || 0,
    };
  }
}
