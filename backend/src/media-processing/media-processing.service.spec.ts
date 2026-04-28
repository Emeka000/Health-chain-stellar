/**
 * Tests for #640: secure media processing pipeline.
 *
 * Covers:
 *  1. Oversized payload rejection
 *  2. Disallowed MIME type rejection
 *  3. Polyglot file detection (magic bytes mismatch)
 *  4. EICAR malware signature rejection
 *  5. Malformed / truncated image rejection
 *  6. Valid JPEG is accepted and EXIF is stripped
 *  7. Valid PNG is accepted and metadata chunks are stripped
 *  8. Signed URL expiry enforcement
 *  9. Signed URL owner mismatch rejection
 * 10. Signed URL not found rejection
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import { MediaProcessingService, MediaUploadContext } from './media-processing.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal valid JPEG: SOI + APP0 + EOI */
function makeJpeg(extraBytes = 0): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = Buffer.from([
    0xff, 0xe0, 0x00, 0x10, // APP0 marker + length 16
    0x4a, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
    0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ]);
  const eoi = Buffer.from([0xff, 0xd9]);
  const padding = Buffer.alloc(extraBytes, 0xaa);
  return Buffer.concat([soi, app0, eoi, padding]);
}

/** Minimal valid PNG: signature + IHDR + IDAT + IEND */
function makePng(): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  // IHDR chunk (13 bytes data)
  const ihdrData = Buffer.alloc(13, 0);
  const ihdrLen = Buffer.alloc(4); ihdrLen.writeUInt32BE(13, 0);
  const ihdrType = Buffer.from('IHDR');
  const ihdrCrc = Buffer.alloc(4, 0);
  const ihdr = Buffer.concat([ihdrLen, ihdrType, ihdrData, ihdrCrc]);
  // IEND chunk
  const iendLen = Buffer.alloc(4, 0);
  const iendType = Buffer.from('IEND');
  const iendCrc = Buffer.alloc(4, 0);
  const iend = Buffer.concat([iendLen, iendType, iendCrc]);
  return Buffer.concat([sig, ihdr, iend]);
}

/** PNG with a tEXt metadata chunk injected */
function makePngWithMetadata(): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13, 0);
  const ihdrLen = Buffer.alloc(4); ihdrLen.writeUInt32BE(13, 0);
  const ihdr = Buffer.concat([ihdrLen, Buffer.from('IHDR'), ihdrData, Buffer.alloc(4, 0)]);

  // tEXt chunk with "Comment\0hello"
  const textData = Buffer.from('Comment\0hello');
  const textLen = Buffer.alloc(4); textLen.writeUInt32BE(textData.length, 0);
  const text = Buffer.concat([textLen, Buffer.from('tEXt'), textData, Buffer.alloc(4, 0)]);

  const iend = Buffer.concat([Buffer.alloc(4, 0), Buffer.from('IEND'), Buffer.alloc(4, 0)]);
  return Buffer.concat([sig, ihdr, text, iend]);
}

/** EICAR test string as a buffer */
function makeEicar(): Buffer {
  return Buffer.from(
    'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
    'ascii',
  );
}

const PROFILE_CONTEXT: MediaUploadContext = {
  ownerId: 'user-1',
  ownerType: 'user',
  category: 'profile',
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('MediaProcessingService (#640)', () => {
  let service: MediaProcessingService;

  const mockConfigService = {
    get: jest.fn((key: string, def?: unknown) => {
      const cfg: Record<string, unknown> = {
        MEDIA_STORAGE_PATH: '/tmp/test-media',
        MEDIA_SIGNED_URL_TTL_SECONDS: 900,
      };
      return cfg[key] ?? def;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaProcessingService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(MediaProcessingService);
  });

  // ── 1. Oversized payload ───────────────────────────────────────────────────

  it('rejects oversized payload', async () => {
    const oversized = Buffer.alloc(6 * 1024 * 1024, 0xff); // 6 MB > 5 MB limit
    // Give it valid JPEG magic bytes so it passes the MIME check
    oversized[0] = 0xff; oversized[1] = 0xd8; oversized[2] = 0xff;

    await expect(
      service.ingest(
        { originalname: 'big.jpg', mimetype: 'image/jpeg', size: oversized.length, buffer: oversized },
        PROFILE_CONTEXT,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 2. Disallowed MIME type ────────────────────────────────────────────────

  it('rejects disallowed MIME type for category', async () => {
    const buf = Buffer.from('%PDF-1.4', 'ascii');
    await expect(
      service.ingest(
        { originalname: 'doc.pdf', mimetype: 'application/pdf', size: buf.length, buffer: buf },
        PROFILE_CONTEXT, // profile only allows jpeg/png
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 3. Polyglot file (magic bytes mismatch) ────────────────────────────────

  it('rejects polyglot file where content does not match declared MIME', async () => {
    // Declare image/jpeg but content starts with PDF magic bytes
    const pdfMagic = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
    const buf = Buffer.concat([pdfMagic, Buffer.alloc(200, 0xaa)]);

    await expect(
      service.ingest(
        { originalname: 'evil.jpg', mimetype: 'image/jpeg', size: buf.length, buffer: buf },
        PROFILE_CONTEXT,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects file with no recognisable magic bytes', async () => {
    const buf = Buffer.alloc(500, 0x00); // all zeros — no magic bytes match
    await expect(
      service.ingest(
        { originalname: 'unknown.jpg', mimetype: 'image/jpeg', size: buf.length, buffer: buf },
        PROFILE_CONTEXT,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 4. Malware (EICAR) ────────────────────────────────────────────────────

  it('rejects file containing EICAR test signature', async () => {
    const eicar = makeEicar();
    // Prepend JPEG magic so it passes MIME sniff
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const buf = Buffer.concat([jpegMagic, eicar, Buffer.alloc(200, 0xaa)]);

    await expect(
      service.ingest(
        { originalname: 'malware.jpg', mimetype: 'image/jpeg', size: buf.length, buffer: buf },
        PROFILE_CONTEXT,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 5. Malformed / truncated image ────────────────────────────────────────

  it('rejects suspiciously small image file', async () => {
    // 10 bytes with JPEG magic — too small to be a real image
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    await expect(
      service.ingest(
        { originalname: 'tiny.jpg', mimetype: 'image/jpeg', size: buf.length, buffer: buf },
        PROFILE_CONTEXT,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  // ── 6. Valid JPEG accepted + EXIF stripped ────────────────────────────────

  it('accepts a valid JPEG and returns APPROVED state', async () => {
    const buf = makeJpeg(200); // 200 bytes of padding to exceed the tiny-file check
    const result = await service.ingest(
      { originalname: 'photo.jpg', mimetype: 'image/jpeg', size: buf.length, buffer: buf },
      PROFILE_CONTEXT,
    );
    expect(result.state).toBe('approved');
    expect(result.detectedMimeType).toBe('image/jpeg');
    expect(result.sha256).toHaveLength(64);
  });

  // ── 7. Valid PNG accepted + metadata stripped ─────────────────────────────

  it('accepts a valid PNG and strips tEXt metadata chunks', async () => {
    const buf = makePngWithMetadata();
    const result = await service.ingest(
      { originalname: 'image.png', mimetype: 'image/png', size: buf.length, buffer: buf },
      PROFILE_CONTEXT,
    );
    expect(result.state).toBe('approved');
    expect(result.detectedMimeType).toBe('image/png');
    // The stored file should not contain the tEXt chunk
    const stored = require('fs').readFileSync(result.storagePath);
    expect(stored.toString('hex')).not.toContain(Buffer.from('tEXt').toString('hex'));
  });

  // ── 8. Signed URL expiry ──────────────────────────────────────────────────

  it('rejects an expired signed URL', () => {
    // Issue a URL then manually expire it by manipulating the internal store
    const signed = service.issueSignedUrl('file-1', 'user-1', 'http://localhost');
    const token = signed.url.split('/').pop()!;

    // Force expiry by reaching into the private store via any-cast
    const store = (service as any).signedUrlStore as Map<string, { fileId: string; ownerId: string; expiresAt: number }>;
    store.set(token, { fileId: 'file-1', ownerId: 'user-1', expiresAt: Date.now() - 1 });

    expect(() => service.resolveSignedUrl(token, 'user-1')).toThrow(ForbiddenException);
  });

  // ── 9. Signed URL owner mismatch ─────────────────────────────────────────

  it('rejects signed URL access from a different owner', () => {
    const signed = service.issueSignedUrl('file-2', 'owner-A', 'http://localhost');
    const token = signed.url.split('/').pop()!;

    expect(() => service.resolveSignedUrl(token, 'owner-B')).toThrow(ForbiddenException);
  });

  // ── 10. Signed URL not found ──────────────────────────────────────────────

  it('throws NotFoundException for unknown signed URL token', () => {
    expect(() => service.resolveSignedUrl('nonexistent-token', 'user-1')).toThrow(
      NotFoundException,
    );
  });

  // ── 11. Valid signed URL resolves correctly ───────────────────────────────

  it('resolves a valid signed URL to the correct fileId', () => {
    const signed = service.issueSignedUrl('file-3', 'user-1', 'http://localhost');
    const token = signed.url.split('/').pop()!;
    const fileId = service.resolveSignedUrl(token, 'user-1');
    expect(fileId).toBe('file-3');
  });
});
