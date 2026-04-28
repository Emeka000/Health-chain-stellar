import { BadRequestException, Injectable } from '@nestjs/common';

export type ArtifactCategory = 'photo' | 'signature' | 'medical' | 'evidence';

interface UploadPolicy {
  allowedMimeTypes: string[];
  allowedExtensions: string[];
  maxBytes: number;
  /** Leading magic bytes for content sniffing: [offset, hex string] */
  magicBytes: Array<[number, string]>;
}

const POLICIES: Record<ArtifactCategory, UploadPolicy> = {
  photo: {
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    allowedExtensions: ['.jpg', '.jpeg', '.png'],
    maxBytes: 5 * 1024 * 1024,
    magicBytes: [
      [0, 'ffd8ff'],   // JPEG
      [0, '89504e47'], // PNG
    ],
  },
  signature: {
    allowedMimeTypes: ['image/png', 'image/svg+xml', 'application/pdf'],
    allowedExtensions: ['.png', '.svg', '.pdf'],
    maxBytes: 2 * 1024 * 1024,
    magicBytes: [
      [0, '89504e47'], // PNG
      [0, '3c737667'], // SVG (<svg)
      [0, '25504446'], // PDF (%PDF)
    ],
  },
  medical: {
    allowedMimeTypes: ['application/pdf', 'application/json'],
    allowedExtensions: ['.pdf', '.json'],
    maxBytes: 10 * 1024 * 1024,
    magicBytes: [
      [0, '25504446'], // PDF
      [0, '7b'],       // JSON ({)
      [0, '5b'],       // JSON ([)
    ],
  },
  evidence: {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf'],
    maxBytes: 10 * 1024 * 1024,
    magicBytes: [
      [0, 'ffd8ff'],
      [0, '89504e47'],
      [0, '25504446'],
    ],
  },
};

export interface UploadAuditMetadata {
  originalName: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  sizeBytes: number;
  sha256: string;
  category: ArtifactCategory;
  acceptedAt: string;
}

@Injectable()
export class UploadValidationService {
  validate(
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    category: ArtifactCategory,
  ): void {
    const policy = POLICIES[category];
    const ext = this.extension(file.originalname).toLowerCase();

    if (!policy.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `[${category}] Declared MIME type '${file.mimetype}' is not allowed. Allowed: ${policy.allowedMimeTypes.join(', ')}`,
      );
    }

    if (!policy.allowedExtensions.includes(ext)) {
      throw new BadRequestException(
        `[${category}] File extension '${ext}' is not allowed. Allowed: ${policy.allowedExtensions.join(', ')}`,
      );
    }

    if (file.size > policy.maxBytes) {
      throw new BadRequestException(
        `[${category}] File size ${file.size} bytes exceeds maximum ${policy.maxBytes} bytes`,
      );
    }

    const detected = this.sniffMimeType(file.buffer, policy.magicBytes);
    if (detected !== null && !policy.allowedMimeTypes.includes(detected)) {
      throw new BadRequestException(
        `[${category}] File content does not match declared MIME type '${file.mimetype}' (detected: ${detected})`,
      );
    }
  }

  buildAuditMetadata(
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    category: ArtifactCategory,
    sha256: string,
  ): UploadAuditMetadata {
    const policy = POLICIES[category];
    const detected = this.sniffMimeType(file.buffer, policy.magicBytes);
    return {
      originalName: file.originalname,
      declaredMimeType: file.mimetype,
      detectedMimeType: detected,
      sizeBytes: file.size,
      sha256,
      category,
      acceptedAt: new Date().toISOString(),
    };
  }

  private sniffMimeType(
    buffer: Buffer,
    magicBytes: Array<[number, string]>,
  ): string | null {
    if (!buffer || buffer.length < 4) return null;
    const hex = buffer.toString('hex');
    for (const [offset, magic] of magicBytes) {
      const start = offset * 2;
      if (hex.startsWith(magic, start)) {
        return this.magicToMime(magic);
      }
    }
    return 'application/octet-stream';
  }

  private magicToMime(magic: string): string {
    const map: Record<string, string> = {
      ffd8ff: 'image/jpeg',
      '89504e47': 'image/png',
      '25504446': 'application/pdf',
      '3c737667': 'image/svg+xml',
      '7b': 'application/json',
      '5b': 'application/json',
    };
    return map[magic] ?? 'application/octet-stream';
  }

  private extension(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(idx) : '';
  }
}
