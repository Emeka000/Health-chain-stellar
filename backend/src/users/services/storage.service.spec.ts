import * as fs from 'fs/promises';
import * as path from 'path';

import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { StorageService } from './storage.service';

jest.mock('fs/promises');

// uuid mock — v4 is a jest.fn() so we can control its return value per test
const mockV4 = jest.fn<string, []>().mockReturnValue('test-uuid');
jest.mock('uuid', () => ({ v4: () => mockV4() }));

// Prevent AWS SDK from loading credentials/config files (incompatible with Node 24 in CI)
const mockS3Send = jest
  .fn<Promise<unknown>, [{ input: { Key?: string; Bucket?: string } }]>()
  .mockResolvedValue({});
jest.mock('@aws-sdk/client-s3', () => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const actual = jest.requireActual('@aws-sdk/client-s3');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  };
});

const FILE = Buffer.from('data');

function makeService(overrides: Record<string, string> = {}): StorageService {
  const defaults: Record<string, string> = {
    STORAGE_TYPE: 'local',
    UPLOAD_DIR: '/tmp/uploads',
    S3_BUCKET: 'test-bucket',
    AWS_REGION: 'us-east-1',
    ...overrides,
  };
  const configService = {
    get: (key: string, fallback?: string) => defaults[key] ?? fallback,
  } as unknown as ConfigService;
  return new StorageService(configService);
}

describe('StorageService – local backend', () => {
  let service: StorageService;

  beforeEach(() => {
    service = makeService();
    mockV4.mockReturnValue('test-uuid');
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.unlink as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  describe('uploadFile key structure', () => {
    it.each([
      ['avatars', 'photo.jpg', 'avatars/test-uuid.jpg'],
      ['proof', 'receipt.pdf', 'proof/test-uuid.pdf'],
      ['evidence', 'scan.png', 'evidence/test-uuid.png'],
    ])('subfolder=%s produces key %s', async (subfolder, name, expectedKey) => {
      const result = await service.uploadFile(
        FILE,
        name,
        'image/jpeg',
        subfolder,
      );
      expect(result.key).toBe(expectedKey);
      expect(result.url).toBe(`/uploads/${expectedKey}`);
      expect(result.bucket).toBe('local');
    });

    it('writes to the correct subfolder directory', async () => {
      await service.uploadFile(FILE, 'doc.pdf', 'application/pdf', 'proof');
      expect(fs.mkdir).toHaveBeenCalledWith('/tmp/uploads/proof', {
        recursive: true,
      });
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/tmp/uploads/proof/test-uuid.pdf',
        FILE,
      );
    });

    it('does not silently rewrite subfolder to avatars', async () => {
      const result = await service.uploadFile(
        FILE,
        'evidence.jpg',
        'image/jpeg',
        'evidence',
      );
      expect(result.key).not.toMatch(/^avatars\//);
    });
  });

  describe('deleteFile key structure', () => {
    it.each([
      ['avatars/test-uuid.jpg'],
      ['proof/test-uuid.pdf'],
      ['evidence/test-uuid.png'],
    ])('deletes correct path for key %s', async (key) => {
      await service.deleteFile(key);
      expect(fs.unlink).toHaveBeenCalledWith(path.join('/tmp/uploads', key));
    });

    it('upload→delete is symmetric for proof artifacts', async () => {
      const { key } = await service.uploadFile(
        FILE,
        'proof.pdf',
        'application/pdf',
        'proof',
      );
      await service.deleteFile(key);
      expect(fs.unlink).toHaveBeenCalledWith(path.join('/tmp/uploads', key));
    });

    it('upload→delete is symmetric for evidence artifacts', async () => {
      const { key } = await service.uploadFile(
        FILE,
        'scan.png',
        'image/png',
        'evidence',
      );
      await service.deleteFile(key);
      expect(fs.unlink).toHaveBeenCalledWith(path.join('/tmp/uploads', key));
    });
  });

  describe('artifact coexistence', () => {
    it('avatar, proof, and evidence keys do not collide', async () => {
      mockV4
        .mockReturnValueOnce('uuid-1')
        .mockReturnValueOnce('uuid-2')
        .mockReturnValueOnce('uuid-3');

      const avatar = await service.uploadFile(
        FILE,
        'a.jpg',
        'image/jpeg',
        'avatars',
      );
      const proof = await service.uploadFile(
        FILE,
        'b.pdf',
        'application/pdf',
        'proof',
      );
      const evidence = await service.uploadFile(
        FILE,
        'c.png',
        'image/png',
        'evidence',
      );

      expect(new Set([avatar.key, proof.key, evidence.key]).size).toBe(3);
      expect(avatar.key).toMatch(/^avatars\//);
      expect(proof.key).toMatch(/^proof\//);
      expect(evidence.key).toMatch(/^evidence\//);
    });
  });
});

describe('StorageService – S3 backend', () => {
  let service: StorageService;

  beforeEach(() => {
    mockS3Send.mockClear();
    mockS3Send.mockResolvedValue({});
    mockV4.mockReturnValue('test-uuid');
    service = makeService({ STORAGE_TYPE: 's3', S3_BUCKET: 'my-bucket' });
  });

  afterEach(() => jest.clearAllMocks());

  describe('uploadFile key structure', () => {
    it.each([
      ['avatars', 'photo.jpg', 'avatars/test-uuid.jpg'],
      ['proof', 'receipt.pdf', 'proof/test-uuid.pdf'],
      ['evidence', 'scan.png', 'evidence/test-uuid.png'],
    ])('subfolder=%s produces key %s', async (subfolder, name, expectedKey) => {
      const result = await service.uploadFile(
        FILE,
        name,
        'image/jpeg',
        subfolder,
      );
      expect(result.key).toBe(expectedKey);
      expect(result.bucket).toBe('my-bucket');
    });

    it('sends PutObjectCommand with correct Key for proof subfolder', async () => {
      await service.uploadFile(FILE, 'doc.pdf', 'application/pdf', 'proof');
      const input = mockS3Send.mock.calls[0][0].input as {
        Key: string;
        Bucket: string;
      };
      expect(input.Key).toBe('proof/test-uuid.pdf');
      expect(input.Bucket).toBe('my-bucket');
    });
  });

  describe('deleteFile key structure', () => {
    it('upload→delete is symmetric for proof artifacts', async () => {
      const { key, bucket } = await service.uploadFile(
        FILE,
        'proof.pdf',
        'application/pdf',
        'proof',
      );
      await service.deleteFile(key, bucket);
      const input = mockS3Send.mock.calls[1][0].input as {
        Key: string;
        Bucket: string;
      };
      expect(input.Key).toBe('proof/test-uuid.pdf');
      expect(input.Bucket).toBe('my-bucket');
    });

    it('defaults to configured bucket when bucket arg is omitted', async () => {
      await service.deleteFile('evidence/test-uuid.png');
      const input = mockS3Send.mock.calls[0][0].input as {
        Key: string;
        Bucket: string;
      };
      expect(input.Bucket).toBe('my-bucket');
    });

    it.each([
      ['avatars/test-uuid.jpg'],
      ['proof/test-uuid.pdf'],
      ['evidence/test-uuid.png'],
    ])('preserves subfolder in delete key for %s', async (key) => {
      await service.deleteFile(key);
      const input = mockS3Send.mock.calls[0][0].input as { Key: string };
      expect(input.Key).toBe(key);
    });
  });

  it('throws when S3_BUCKET is not configured', () => {
    expect(() => makeService({ STORAGE_TYPE: 's3', S3_BUCKET: '' })).toThrow(
      InternalServerErrorException,
    );
  });
});
