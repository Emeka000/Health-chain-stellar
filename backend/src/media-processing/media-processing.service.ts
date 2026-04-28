import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ─── Types ────────────────────────────────────────────────────────────────────

export enum MediaProcessingState {
  QUARANTINED = 'quarantined',
  SCANNING = 'scanning',
  PROCESSING = 'processing',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export interface MediaUploadContext {
  ownerId: string;
  ownerType: string;
  category: 'profile' | 'evidence' | 'medical' | 'signature';
}

export interface ProcessedMedia {
  fileId: string;
  state: MediaProcessingState;
  storagePath: string;
  sha256: string;
  sizeBytes: number;
  detectedMimeType: string;
  rejectionReason?: string;
  processedAt: string;
}

export interface SignedUrlResult {
  url: string;
  expiresAt: string;
  fileId: string;
}

// ─── Policy table ─────────────────────────────────────────────────────────────

interface MediaPolicy {
  allowedMimeTypes: string[];
  maxBytes: number;
  /** [offset, hex magic bytes] */
  magicBytes: Array<[number, string]>;
  /** Whether to strip EXIF/metadata before serving */
  stripMetadata: boolean;
}

const MEDIA_POLICIES: Record<string, MediaPolicy> = {
  profile: {
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    maxBytes: 5 * 1024 * 1024,
    magicBytes: [[0, 'ffd8ff'], [0, '89504e47']],
    stripMetadata: true,
  },
  evidence: {
    allowedMimeTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    maxBytes: 10 * 1024 * 1024,
    magicBytes: [[0, 'ffd8ff'], [0, '89504e47'], [0, '25504446']],
    stripMetadata: true,
  },
  medical: {
    allowedMimeTypes: ['application/pdf', 'application/json'],
    maxBytes: 10 * 1024 * 1024,
    magicBytes: [[0, '25504446'], [0, '7b'], [0, '5b']],
    stripMetadata: false,
  },
  signature: {
    allowedMimeTypes: ['image/png', 'image/svg+xml', 'application/pdf'],
    maxBytes: 2 * 1024 * 1024,
    magicBytes: [[0, '89504e47'], [0, '3c737667'], [0, '25504446']],
    stripMetadata: true,
  },
};

const MAGIC_TO_MIME: Record<string, string> = {
  ffd8ff: 'image/jpeg',
  '89504e47': 'image/png',
  '25504446': 'application/pdf',
  '3c737667': 'image/svg+xml',
  '7b': 'application/json',
  '5b': 'application/json',
};

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class MediaProcessingService {
  private readonly logger = new Logger(MediaProcessingService.name);

  /** In-memory store for signed URL tokens: token → { fileId, expiresAt } */
  private readonly signedUrlStore = new Map<
    string,
    { fileId: string; ownerId: string; expiresAt: number }
  >();

  /** Signed URL TTL in seconds (default 15 minutes) */
  private readonly signedUrlTtlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    this.signedUrlTtlSeconds = this.configService.get<number>(
      'MEDIA_SIGNED_URL_TTL_SECONDS',
      900,
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Full ingestion pipeline:
   *  1. Size + MIME policy check
   *  2. Magic-byte sniff (polyglot / content-type mismatch detection)
   *  3. Malware scan stub
   *  4. Metadata strip (JPEG EXIF, PNG tEXt chunks)
   *  5. Write to approved storage path
   *
   * Throws BadRequestException with an auditable reason on any failure.
   * Never writes to the approved path until all checks pass.
   */
  async ingest(
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    context: MediaUploadContext,
  ): Promise<ProcessedMedia> {
    const policy = MEDIA_POLICIES[context.category];
    if (!policy) {
      throw new BadRequestException(`Unknown media category: ${context.category}`);
    }

    const fileId = crypto.randomUUID();

    // 1. Size check
    if (file.size > policy.maxBytes) {
      return this.reject(fileId, `File size ${file.size} exceeds limit ${policy.maxBytes}`);
    }

    // 2. Declared MIME check
    if (!policy.allowedMimeTypes.includes(file.mimetype)) {
      return this.reject(fileId, `Declared MIME '${file.mimetype}' not allowed for category '${context.category}'`);
    }

    // 3. Magic-byte sniff — catches polyglot files
    const detectedMime = this.sniffMime(file.buffer, policy.magicBytes);
    if (detectedMime === 'application/octet-stream') {
      return this.reject(fileId, `File content does not match any allowed magic bytes for category '${context.category}'`);
    }
    if (!policy.allowedMimeTypes.includes(detectedMime)) {
      return this.reject(
        fileId,
        `Content sniff detected '${detectedMime}' but declared '${file.mimetype}' — possible polyglot file`,
      );
    }

    // 4. Malware scan
    const scanResult = await this.malwareScan(file.buffer, file.originalname);
    if (!scanResult.clean) {
      return this.reject(fileId, `Malware scan failed: ${scanResult.reason}`);
    }

    // 5. Metadata strip
    const sanitizedBuffer = policy.stripMetadata
      ? this.stripMetadata(file.buffer, detectedMime)
      : file.buffer;

    // 6. Compute digest of sanitized content
    const sha256 = crypto
      .createHash('sha256')
      .update(sanitizedBuffer)
      .digest('hex');

    // 7. Write to approved storage
    const storagePath = this.approvedPath(context, fileId, file.originalname);
    this.ensureDir(path.dirname(storagePath));
    fs.writeFileSync(storagePath, sanitizedBuffer);

    this.logger.log(
      `Media approved: fileId=${fileId} category=${context.category} mime=${detectedMime} size=${sanitizedBuffer.length}`,
    );

    return {
      fileId,
      state: MediaProcessingState.APPROVED,
      storagePath,
      sha256,
      sizeBytes: sanitizedBuffer.length,
      detectedMimeType: detectedMime,
      processedAt: new Date().toISOString(),
    };
  }

  /**
   * Issue a short-lived signed URL token for an approved file.
   * The token is a random hex string stored in memory with an expiry.
   */
  issueSignedUrl(fileId: string, ownerId: string, baseUrl: string): SignedUrlResult {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.signedUrlTtlSeconds * 1000;
    this.signedUrlStore.set(token, { fileId, ownerId, expiresAt });

    return {
      url: `${baseUrl}/media/serve/${token}`,
      expiresAt: new Date(expiresAt).toISOString(),
      fileId,
    };
  }

  /**
   * Validate a signed URL token and return the file path if valid.
   * Throws ForbiddenException if expired, not found, or owner mismatch.
   */
  resolveSignedUrl(token: string, requestingOwnerId: string): string {
    const entry = this.signedUrlStore.get(token);
    if (!entry) {
      throw new NotFoundException('Signed URL not found or already expired');
    }
    if (Date.now() > entry.expiresAt) {
      this.signedUrlStore.delete(token);
      throw new ForbiddenException('Signed URL has expired');
    }
    if (entry.ownerId !== requestingOwnerId) {
      throw new ForbiddenException('Access denied: signed URL belongs to a different owner');
    }
    return entry.fileId;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private reject(fileId: string, reason: string): ProcessedMedia {
    this.logger.warn(`Media rejected: fileId=${fileId} reason=${reason}`);
    throw new BadRequestException(
      JSON.stringify({ fileId, reason, rejectedAt: new Date().toISOString() }),
    );
  }

  private sniffMime(buffer: Buffer, magicBytes: Array<[number, string]>): string {
    if (!buffer || buffer.length < 4) return 'application/octet-stream';
    const hex = buffer.toString('hex');
    for (const [offset, magic] of magicBytes) {
      const start = offset * 2;
      if (hex.startsWith(magic, start)) {
        return MAGIC_TO_MIME[magic] ?? 'application/octet-stream';
      }
    }
    return 'application/octet-stream';
  }

  /**
   * Malware scan stub.
   *
   * In production this should delegate to a real AV engine (e.g. ClamAV via
   * clamscan, or a cloud API).  The stub rejects files that contain known
   * EICAR test string patterns so tests can exercise the rejection path.
   */
  private async malwareScan(
    buffer: Buffer,
    filename: string,
  ): Promise<{ clean: boolean; reason?: string }> {
    // EICAR test string detection (safe to include in source — it's the test pattern)
    const EICAR_SIGNATURE = Buffer.from(
      '58354f2150254041505b345c505a58353428505e2937434329377d2445494341522d5354414e44415244',
      'hex',
    );
    if (buffer.includes(EICAR_SIGNATURE)) {
      return { clean: false, reason: 'EICAR test signature detected' };
    }

    // Reject suspiciously small files that claim to be images (possible exploit)
    if (filename.match(/\.(jpg|jpeg|png)$/i) && buffer.length < 100) {
      return { clean: false, reason: 'Suspiciously small image file' };
    }

    // TODO: integrate real AV engine (ClamAV / cloud scan API)
    return { clean: true };
  }

  /**
   * Strip unsafe metadata from images.
   *
   * For JPEG: removes all APP1 (EXIF) and APP13 (IPTC) segments.
   * For PNG: removes all ancillary chunks (tEXt, iTXt, zTXt, tIME, etc.)
   *          keeping only IHDR, IDAT, IEND.
   *
   * For other types (PDF, JSON, SVG) the buffer is returned unchanged —
   * a production implementation would use a dedicated library.
   */
  private stripMetadata(buffer: Buffer, mimeType: string): Buffer {
    try {
      if (mimeType === 'image/jpeg') return this.stripJpegExif(buffer);
      if (mimeType === 'image/png') return this.stripPngMetadata(buffer);
    } catch (err) {
      this.logger.warn(`Metadata strip failed (${mimeType}): ${(err as Error).message} — using original`);
    }
    return buffer;
  }

  /** Remove JPEG APP1 (EXIF) and APP13 (IPTC) segments */
  private stripJpegExif(buffer: Buffer): Buffer {
    const segments: Buffer[] = [];
    let i = 0;

    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return buffer; // not JPEG

    segments.push(buffer.slice(0, 2)); // SOI marker
    i = 2;

    while (i < buffer.length - 1) {
      if (buffer[i] !== 0xff) break;
      const marker = buffer[i + 1];
      if (marker === 0xd9) { // EOI
        segments.push(buffer.slice(i));
        break;
      }
      if (marker === 0xda) { // SOS — rest is image data
        segments.push(buffer.slice(i));
        break;
      }
      const segLen = buffer.readUInt16BE(i + 2);
      const isExif = marker === 0xe1; // APP1
      const isIptc = marker === 0xed; // APP13
      if (!isExif && !isIptc) {
        segments.push(buffer.slice(i, i + 2 + segLen));
      }
      i += 2 + segLen;
    }

    return Buffer.concat(segments);
  }

  /** Remove all non-critical PNG chunks (keep IHDR, IDAT, IEND) */
  private stripPngMetadata(buffer: Buffer): Buffer {
    const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!buffer.slice(0, 8).equals(PNG_SIG)) return buffer;

    const KEEP_CHUNKS = new Set(['IHDR', 'IDAT', 'IEND', 'PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP']);
    const out: Buffer[] = [PNG_SIG];
    let i = 8;

    while (i < buffer.length) {
      const length = buffer.readUInt32BE(i);
      const type = buffer.slice(i + 4, i + 8).toString('ascii');
      const chunkEnd = i + 4 + 4 + length + 4;
      if (KEEP_CHUNKS.has(type)) {
        out.push(buffer.slice(i, chunkEnd));
      }
      i = chunkEnd;
    }

    return Buffer.concat(out);
  }

  private approvedPath(
    context: MediaUploadContext,
    fileId: string,
    originalname: string,
  ): string {
    const ext = path.extname(originalname).toLowerCase() || '.bin';
    const base = this.configService.get<string>('MEDIA_STORAGE_PATH', '/tmp/media');
    return path.join(base, context.ownerType, context.ownerId, `${fileId}${ext}`);
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
