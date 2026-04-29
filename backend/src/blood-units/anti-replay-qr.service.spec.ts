import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';

// Mock entity modules before importing the service to avoid BaseEntity reference error
jest.mock('./entities/blood-unit.entity', () => ({
  BloodUnitEntity: class BloodUnitEntity {},
  BloodUnit: class BloodUnit {},
}));
jest.mock('./entities/qr-verification-log.entity', () => ({
  QrVerificationLogEntity: class QrVerificationLogEntity {},
  QrVerificationResult: { MATCH: 'MATCH', MISMATCH: 'MISMATCH' },
}));
jest.mock('./entities/qr-nonce-registry.entity', () => ({
  QrNonceRegistryEntity: class QrNonceRegistryEntity {},
  QrNonceStatus: { UNUSED: 'UNUSED', CONSUMED: 'CONSUMED', EXPIRED: 'EXPIRED' },
}));

import { AntiReplayQrService } from './anti-replay-qr.service';
import { QrNonceStatus } from './entities/qr-nonce-registry.entity';

const BLOOD_UNIT_TOKEN = 'BloodUnitEntityRepository';
const LOG_TOKEN = 'QrVerificationLogEntityRepository';
const NONCE_TOKEN = 'QrNonceRegistryEntityRepository';

const mockBloodUnitRepo = { findOne: jest.fn() };
const mockLogRepo = { save: jest.fn(), create: jest.fn((x) => x) };
const mockNonceRepo = {
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn((x) => x),
  update: jest.fn(),
};
const mockConfig = { get: jest.fn((_key: string, def: string) => def) };

describe('AntiReplayQrService', () => {
  let service: AntiReplayQrService;

  beforeEach(async () => {
    // Use string-based tokens to avoid TypeORM entity metadata issues in tests
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AntiReplayQrService,
        { provide: BLOOD_UNIT_TOKEN, useValue: mockBloodUnitRepo },
        { provide: LOG_TOKEN, useValue: mockLogRepo },
        { provide: NONCE_TOKEN, useValue: mockNonceRepo },
        { provide: ConfigService, useValue: mockConfig },
      ],
    })
      .overrideProvider(AntiReplayQrService)
      .useFactory({
        factory: () =>
          new AntiReplayQrService(
            mockBloodUnitRepo as any,
            mockLogRepo as any,
            mockNonceRepo as any,
            mockConfig as any,
          ),
      })
      .compile();

    service = module.get(AntiReplayQrService);
    jest.clearAllMocks();
  });

  describe('issueQrPayload', () => {
    it('issues a signed payload with nonce', async () => {
      mockBloodUnitRepo.findOne.mockResolvedValue({ unitNumber: 'U001', bloodType: 'A+', bankId: 'B1' });
      mockNonceRepo.save.mockResolvedValue({});

      const payload = await service.issueQrPayload('U001');
      expect(payload.nonce).toBeDefined();
      expect(payload.signature).toBeDefined();
      expect(payload.unitNumber).toBe('U001');
      expect(new Date(payload.expiresAt) > new Date()).toBe(true);
    });

    it('throws NotFoundException for unknown unit', async () => {
      mockBloodUnitRepo.findOne.mockResolvedValue(null);
      await expect(service.issueQrPayload('UNKNOWN')).rejects.toThrow(NotFoundException);
    });

    it('issues offline payload with longer TTL', async () => {
      mockBloodUnitRepo.findOne.mockResolvedValue({ unitNumber: 'U001', bloodType: 'A+', bankId: 'B1' });
      mockNonceRepo.save.mockResolvedValue({});

      const payload = await service.issueQrPayload('U001', true);
      expect(payload.offline).toBe(true);
      // Offline TTL is 8 hours — expiry should be > 1 hour from now
      const expiresIn = new Date(payload.expiresAt).getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(60 * 60 * 1000);
    });
  });

  describe('verify', () => {
    it('verifies a valid payload and consumes nonce', async () => {
      mockBloodUnitRepo.findOne.mockResolvedValue({ unitNumber: 'U001', bloodType: 'A+', bankId: 'B1' });
      mockNonceRepo.save.mockResolvedValue({});

      const issued = await service.issueQrPayload('U001');

      const nonceRecord = {
        nonce: issued.nonce,
        status: QrNonceStatus.UNUSED,
        expiresAt: new Date(issued.expiresAt),
      };
      mockNonceRepo.findOne.mockResolvedValue(nonceRecord);
      mockNonceRepo.save.mockResolvedValue({ ...nonceRecord, status: QrNonceStatus.CONSUMED });
      mockLogRepo.save.mockResolvedValue({});

      const result = await service.verify(JSON.stringify(issued), 'staff-1', 'order-1');
      expect(result.verified).toBe(true);
      expect(result.replayDetected).toBe(false);
    });

    it('detects replay attack (consumed nonce)', async () => {
      mockBloodUnitRepo.findOne.mockResolvedValue({ unitNumber: 'U001', bloodType: 'A+', bankId: 'B1' });
      mockNonceRepo.save.mockResolvedValue({});

      const issued = await service.issueQrPayload('U001');

      mockNonceRepo.findOne.mockResolvedValue({
        nonce: issued.nonce,
        status: QrNonceStatus.CONSUMED,
        expiresAt: new Date(issued.expiresAt),
      });
      mockLogRepo.save.mockResolvedValue({});

      const result = await service.verify(JSON.stringify(issued), 'staff-1', 'order-1');
      expect(result.verified).toBe(false);
      expect(result.replayDetected).toBe(true);
    });

    it('rejects tampered signature', async () => {
      mockBloodUnitRepo.findOne.mockResolvedValue({ unitNumber: 'U001', bloodType: 'A+', bankId: 'B1' });
      mockNonceRepo.save.mockResolvedValue({});
      mockLogRepo.save.mockResolvedValue({});

      const issued = await service.issueQrPayload('U001');
      issued.signature = 'deadbeef'.repeat(8);

      await expect(service.verify(JSON.stringify(issued), 'staff-1', 'order-1'))
        .rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException for invalid JSON', async () => {
      await expect(service.verify('not-json', 'staff-1', 'order-1'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects unknown nonce', async () => {
      mockBloodUnitRepo.findOne.mockResolvedValue({ unitNumber: 'U001', bloodType: 'A+', bankId: 'B1' });
      mockNonceRepo.save.mockResolvedValue({});
      mockLogRepo.save.mockResolvedValue({});

      const issued = await service.issueQrPayload('U001');
      mockNonceRepo.findOne.mockResolvedValue(null); // nonce not in registry

      await expect(service.verify(JSON.stringify(issued), 'staff-1', 'order-1'))
        .rejects.toThrow(UnauthorizedException);
    });
  });

  describe('cleanupExpiredNonces', () => {
    it('marks expired nonces', async () => {
      mockNonceRepo.update.mockResolvedValue({ affected: 3 });
      const count = await service.cleanupExpiredNonces();
      expect(count).toBe(3);
    });
  });
});
