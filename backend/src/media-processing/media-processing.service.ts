import * as crypto from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileMetadataService } from '../file-metadata/file-metadata.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export enum MediaProcessingState {
  QUARANTINED = 'quarantined',
  SCANNING = 'scanning',
  PROCESSING = 'processing',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export const MEDIA_OWNER_TYPES = ['user', 'organization', 'blood_bank'] as const;
export type MediaOwnerType = (typeof MEDIA_OWNER_TYPES)[number];

export interface MediaUploadContext {
  ownerId: string;
  ownerType: MediaOwnerType;
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
  scanner?: { name: string; version: string };
}

export interface SignedUrlResult {
  url: string;
  expiresAt: string;
  fileId: string;
}

// ─── Malware scanner abstraction ──────────────────────────────────────────────

export interface MalwareScanResult {
  clean: boolean;
  reason?: string;
  /** True when the scanner could not be reached / errored — caller must fail closed. */
  unavailable?: boolean;
  scanner: { name: string; version: string };
}

export interface MalwareScanner {
  readonly name: string;
  scan(buffer: Buffer, filename: string): Promise<MalwareScanResult>;
}

/**
 * ClamAV scanner speaking the clamd INSTREAM protocol over TCP.
 * Fails closed: any connection/protocol error yields `unavailable: true`.
 */
export class ClamAvScanner implements MalwareScanner {
  readonly name = 'clamav';

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
    private readonly logger: Logger,
  ) {}

  async scan(buffer: Buffer, filename: string): Promise<MalwareScanResult> {
    try {
      const response = await this.sendInstream(buffer);
      const version = await this.version().catch(() => 'unknown');
      const scanner = { name: this.name, version };

      if (/FOUND/.test(response)) {
        const signature = response.replace(/^.*?:\s*/, '').replace(/\s*FOUND\s*$/, '').trim();
        return { clean: false, reason: `ClamAV detected ${signature || 'malware'} in '${filename}'`, scanner };
      }
      if (/OK/.test(response)) {
        return { clean: true, scanner };
      }
      this.logger.error(`Unexpected clamd response: ${response}`);
      return { clean: false, reason: 'Scanner returned an unrecognised response', unavailable: true, scanner };
    } catch (err) {
      this.logger.error(`ClamAV scan failed: ${(err as Error).message}`);
      return {
        clean: false,
        reason: 'Malware scanner unavailable',
        unavailable: true,
        scanner: { name: this.name, version: 'unknown' },
      };
    }
  }

  private version(): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let data = '';
      socket.setTimeout(this.timeoutMs);
      socket.on('connect', () => socket.write('zVERSION\0'));
      socket.on('data', (chunk) => (data += chunk.toString()));
      socket.on('end', () => resolve(data.replace(/\0/g, '').trim()));
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('clamd version timeout'));
      });
      socket.on('error', reject);
    });
  }

  private sendInstream(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let data = '';
      socket.setTimeout(this.timeoutMs);
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const len = Buffer.alloc(4);
        len.writeUInt32BE(buffer.length, 0);
        socket.write(len);
        socket.write(buffer);
        socket.write(Buffer.from([0, 0, 0, 0]));
      });
      socket.on('data', (chunk) => (data += chunk.toString()));
      socket.on('end', () => resolve(data.replace(/\0/g, '').trim()));
      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('clamd scan timeout'));
      });
      socket.on('error', reject);
    });
  }
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

  /** Pluggable malware scanner (ClamAV by default). */
  private readonly scanner: MalwareScanner;

  constructor(
    private readonly configService: ConfigService,
    private readonly fileMetadataService: FileMetadataService,
  ) {
    this.signedUrlTtlSeconds = this.configService.get<number>(
      'MEDIA_SIGNED_URL_TTL_SECONDS',
      900,
    );

    const host = this.configService.get<string>('CLAMAV_HOST', '127.0.0.1');
    const port = this.configService.get<number>('CLAMAV_PORT', 3310);
    const timeoutMs = this.configService.get<number>('CLAMAV_TIMEOUT_MS', 10000);
    this.scanner = new ClamAvScanner(host, port, timeoutMs, this.logger);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Full ingestion pipeline:
   *  1. Size + MIME policy check
   *  2. Magic-byte sniff (polyglot / content-type mismatch detection)
   *  3. Malware scan (ClamAV, fail-closed)
   *  4. Metadata strip (JPEG EXIF, PNG tEXt chunks, SVG sanitize)
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

    // 4. Malware scan — fail closed when the scanner is unavailable
    const scanResult = await this.malwareScan(file.buffer, file.originalname);
    if (!scanResult.clean) {
      if (scanResult.unavailable) {
        return this.quarantine(fileId, `Malware scanner unavailable: ${scanResult.reason}`, scanResult.scanner);
      }
      return this.reject(fileId, `Malware scan failed: ${scanResult.reason}`, scanResult.scanner);
    }

    // 5. Metadata strip / sanitize
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
      `Media approved: fileId=${fileId} category=${context.category} mime=${detectedMime} size=${sanitizedBuffer.length} scanner=${scanResult.scanner.name}@${scanResult.scanner.version}`,
    );

    return {
      fileId,
      state: MediaProcessingState.APPROVED,
      storagePath,
      sha256,
      sizeBytes: sanitizedBuffer.length,
      detectedMimeType: detectedMime,
      processedAt: new Date().toISOString(),
      scanner: scanResult.scanner,
    };
  }

  /**
   * Issue a short-lived signed URL token for an approved file.
   * The token is a random hex string stored in memory with an expiry.
   */
  async issueSignedUrl(fileId: string, requestingOwnerId: string, baseUrl: string): Promise<SignedUrlResult> {
    const file = await this.fileMetadataService.findById(fileId);
    if (!file) throw new NotFoundException(`File '${fileId}' not found`);
    if (file.ownerId !== requestingOwnerId) throw new ForbiddenException('Access denied: you do not own this file');

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.signedUrlTtlSeconds * 1000;
    this.signedUrlStore.set(token, { fileId, ownerId: requestingOwnerId, expiresAt });

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

  private reject(
    fileId: string,
    reason: string,
    scanner?: { name: string; version: string },
  ): ProcessedMedia {
    this.logger.warn(`Media rejected: fileId=${fileId} reason=${reason}`);
    return {
      fileId,
      state: MediaProcessingState.REJECTED,
      storagePath: '',
      sha256: '',
      sizeBytes: 0,
      detectedMimeType: 'application/octet-stream',
      rejectionReason: reason,
      processedAt: new Date().toISOString(),
      scanner,
    };
  }

  private quarantine(
    fileId: string,
    reason: string,
    scanner?: { name: string; version: string },
  ): ProcessedMedia {
    this.logger.warn(`Media quarantined: fileId=${fileId} reason=${reason}`);
    return {
      fileId,
      state: MediaProcessingState.QUARANTINED,
      storagePath: '',
      sha256: '',
      sizeBytes: 0,
      detectedMimeType: 'application/octet-stream',
      rejectionReason: reason,
      processedAt: new Date().toISOString(),
      scanner,
    };
  }

  /**
   * Scan a buffer for malware via the configured scanner.
   * Fails closed: scanner errors are surfaced as `unavailable` so the caller
   * quarantines the file instead of accepting it.
   */
  private async malwareScan(buffer: Buffer, filename: string): Promise<MalwareScanResult> {
    return this.scanner.scan(buffer, filename);
  }

  private sniffMime(buffer: Buffer, magicBytes: Array<[number, string]>): string {
    for (const [offset, hex] of magicBytes) {
      const bytes = Buffer.from(hex, 'hex');
      if (buffer.length >= offset + bytes.length && buffer.subarray(offset, offset + bytes.length).equals(bytes)) {
        return MAGIC_TO_MIME[hex] ?? 'application/octet-stream';
      }
    }
    return 'application/octet-stream';
  }

  private stripMetadata(buffer: Buffer, mimeType: string): Buffer {
    if (mimeType === 'image/jpeg') {
      return this.stripJpegExif(buffer);
    }
    if (mimeType === 'image/png') {
      return this.stripPngTextChunks(buffer);
    }
    if (mimeType === 'image/svg+xml') {
      return this.sanitizeSvg(buffer);
    }
    // PDF / JSON: no safe in-process sanitizer — return unchanged.
    return buffer;
  }

  /**
   * Reject SVGs containing script/event handlers or external references.
   * Throws BadRequestException so the file is never stored as-is.
   */
  private sanitizeSvg(buffer: Buffer): Buffer {
    const svg = buffer.toString('utf8');
    const dangerous = /<script|javascript:|on\w+\s*=|<!ENTITY|<foreignObject|<iframe|<embed|<object/i;
    if (dangerous.test(svg)) {
      throw new BadRequestException('SVG contains active content and was rejected');
    }
    return buffer;
  }

  private stripJpegExif(buffer: Buffer): Buffer {
    // Minimal EXIF strip: drop APP1 (0xFFE1) segments.
    const out: number[] = [0xff, 0xd8];
    let i = 2;
    while (i < buffer.length - 1) {
      if (buffer[i] !== 0xff) {
        out.push(buffer[i]);
        i += 1;
        continue;
      }
      const marker = buffer[i + 1];
      if (marker === 0xd9) {
        out.push(0xff, 0xd9);
        break;
      }
      if (marker === 0xda) {
        out.push(...buffer.subarray(i));
        break;
      }
      const len = buffer.readUInt16BE(i + 2);
      if (marker !== 0xe1) {
        out.push(...buffer.subarray(i, i + 2 + len));
      }
      i += 2 + len;
    }
    return Buffer.from(out);
  }

  private stripPngTextChunks(buffer: Buffer): Buffer {
    // Minimal PNG tEXt strip: drop tEXt/iTXt/zTXt chunks.
    const out: number[] = [...buffer.subarray(0, 8)];
    let i = 8;
    while (i < buffer.length) {
      const len = buffer.readUInt32BE(i);
      const type = buffer.toString('ascii', i + 4, i + 8);
      const chunkEnd = i + 12 + len;
      if (!['tEXt', 'iTXt', 'zTXt'].includes(type)) {
        out.push(...buffer.subarray(i, chunkEnd));
      }
      i = chunkEnd;
      if (type === 'IEND') break;
    }
    return Buffer.from(out);
  }

  private approvedPath(context: MediaUploadContext, fileId: string, originalName: string): string {
    const ext = path.extname(originalName) || '';
    return path.join(
      this.configService.get<string>('MEDIA_STORAGE_ROOT', 'storage/media'),
      'approved',
      context.ownerType,
      context.ownerId,
      `${fileId}${ext}`,
    );
  }

  private ensureDir(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
  }
}
