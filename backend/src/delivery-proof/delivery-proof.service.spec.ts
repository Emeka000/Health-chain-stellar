import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Keypair } from '@stellar/stellar-sdk';

import { DeliveryProofService } from './delivery-proof.service';
import { DeliveryProofEntity } from './entities/delivery-proof.entity';
import { CustodyService } from '../custody/custody.service';
import { SorobanService } from '../soroban/soroban.service';
import { UploadValidationService } from './upload-validation.service';
import { FileMetadataService } from '../file-metadata/file-metadata.service';

const mockProof = (
  overrides: Partial<DeliveryProofEntity> = {},
): DeliveryProofEntity =>
  ({
    id: 'proof-1',
    deliveryId: 1001,
    orderId: 'order-1',
    riderId: 'rider-1',
    requestId: 'request-1',
    recipientName: 'John Doe',
    recipientSignatureUrl: null,
    photoUrl: null,
    deliveredAt: new Date('2024-01-15T10:00:00Z'),
    temperatureCelsius: 4.0,
    notes: null,
    isTemperatureCompliant: true,
    signerKeyId: 'delivery-proof-key-1',
    signerPublicKey: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    signerRole: 'rider',
    signedAt: new Date('2024-01-15T10:00:00Z'),
    proofSignature: null,
    proofPayloadDigest: null,
    trustedTimestampAt: null,
    timestampAnchorHash: null,
    evidenceDigestReferences: ['a'.repeat(64)],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as DeliveryProofEntity;

const buildRepo = (proofs: DeliveryProofEntity[]) => {
  const qb: any = {
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([proofs, proofs.length]),
    getMany: jest.fn().mockResolvedValue(proofs),
  };
  return {
    findOne: jest.fn(),
    create: jest.fn((entity) => ({ ...entity })),
    save: jest.fn((entity) => Promise.resolve({ id: 'proof-created', ...entity })),
    createQueryBuilder: jest.fn().mockReturnValue(qb),
    _qb: qb,
  };
};

describe('DeliveryProofService', () => {
  let service: DeliveryProofService;
  let repo: ReturnType<typeof buildRepo>;
  let signerKeypair: Keypair;
  const custodyService = { assertCustodyComplete: jest.fn().mockResolvedValue(undefined) };
  const sorobanService = {} as SorobanService;
  const uploadValidation = {} as UploadValidationService;
  const fileMetadata = {} as FileMetadataService;
  const configService = {
    get: jest.fn((key: string, fallback?: string) => {
      if (key === 'DELIVERY_PROOF_SIGNER_KID') return 'delivery-proof-key-1';
      if (key === 'DELIVERY_PROOF_SIGNER_PUBLIC_KEY') return signerKeypair.publicKey();
      if (key === 'DELIVERY_PROOF_PREVIOUS_SIGNER_KID') return undefined;
      if (key === 'DELIVERY_PROOF_PREVIOUS_SIGNER_PUBLIC_KEY') return undefined;
      return fallback;
    }),
  } as unknown as ConfigService;

  beforeEach(async () => {
    repo = buildRepo([mockProof()]);
    signerKeypair = Keypair.random();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryProofService,
        { provide: getRepositoryToken(DeliveryProofEntity), useValue: repo },
        { provide: ConfigService, useValue: configService },
        { provide: CustodyService, useValue: custodyService },
        { provide: SorobanService, useValue: sorobanService },
        { provide: UploadValidationService, useValue: uploadValidation },
        { provide: FileMetadataService, useValue: fileMetadata },
      ],
    }).compile();

    service = module.get(DeliveryProofService);
  });

  const signPayload = (dto: {
    deliveryId: number;
    orderId: string;
    requestId: string;
    riderId: string;
    signerRole: string;
    signedAt: string;
    evidenceDigestReferences: string[];
  }): string => {
    const canonical = JSON.stringify({
      deliveryId: dto.deliveryId,
      orderId: dto.orderId,
      requestId: dto.requestId,
      riderId: dto.riderId,
      signerRole: dto.signerRole,
      signedAt: dto.signedAt,
      evidenceDigestReferences: [...dto.evidenceDigestReferences].sort(),
    });
    const digest = Buffer.from(require('crypto').createHash('sha256').update(canonical).digest('hex'), 'hex');
    return Buffer.from(signerKeypair.sign(digest)).toString('base64');
  };

  describe('getDeliveryProof', () => {
    it('returns proof when found', async () => {
      const proof = mockProof();
      repo.findOne.mockResolvedValue(proof);
      const result = await service.getDeliveryProof('proof-1');
      expect(result).toEqual(proof);
    });

    it('throws NotFoundException when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getDeliveryProof('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getProofsByRider', () => {
    it('queries with riderId filter', async () => {
      await service.getProofsByRider('rider-1', { page: 1, pageSize: 25 });
      expect(repo._qb.andWhere).toHaveBeenCalledWith(
        'proof.riderId = :riderId',
        { riderId: 'rider-1' },
      );
    });

    it('returns paginated response', async () => {
      const result = await service.getProofsByRider('rider-1', {
        page: 1,
        pageSize: 25,
      });
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination.currentPage).toBe(1);
    });
  });

  describe('getProofsByRequest', () => {
    it('queries with requestId filter', async () => {
      await service.getProofsByRequest('request-1', { page: 1, pageSize: 25 });
      expect(repo._qb.andWhere).toHaveBeenCalledWith(
        'proof.requestId = :requestId',
        { requestId: 'request-1' },
      );
    });
  });

  describe('queryProofs', () => {
    it('applies date range filters', async () => {
      await service.queryProofs({
        startDate: '2024-01-01',
        endDate: '2024-01-31',
        page: 1,
        pageSize: 25,
      });
      expect(repo._qb.andWhere).toHaveBeenCalledWith(
        'proof.deliveredAt >= :startDate',
        { startDate: '2024-01-01' },
      );
      expect(repo._qb.andWhere).toHaveBeenCalledWith(
        'proof.deliveredAt <= :endDate',
        { endDate: '2024-01-31' },
      );
    });

    it('applies temperatureCompliantOnly filter', async () => {
      await service.queryProofs({
        temperatureCompliantOnly: true,
        page: 1,
        pageSize: 25,
      });
      expect(repo._qb.andWhere).toHaveBeenCalledWith(
        'proof.isTemperatureCompliant = true',
      );
    });

    it('uses default pagination when not provided', async () => {
      await service.queryProofs({});
      expect(repo._qb.skip).toHaveBeenCalledWith(0);
      expect(repo._qb.take).toHaveBeenCalledWith(25);
    });
  });

  describe('isTemperatureCompliant', () => {
    it('returns true for temperature within range (2-6°C)', () => {
      expect(service.isTemperatureCompliant(2)).toBe(true);
      expect(service.isTemperatureCompliant(4)).toBe(true);
      expect(service.isTemperatureCompliant(6)).toBe(true);
    });

    it('returns false for temperature outside range', () => {
      expect(service.isTemperatureCompliant(1.9)).toBe(false);
      expect(service.isTemperatureCompliant(6.1)).toBe(false);
      expect(service.isTemperatureCompliant(-1)).toBe(false);
    });
  });

  describe('getDeliveryStatistics', () => {
    it('returns correct statistics for a rider', async () => {
      const proofs = [
        mockProof({ isTemperatureCompliant: true, temperatureCelsius: 4.0 }),
        mockProof({
          id: 'proof-2',
          isTemperatureCompliant: false,
          temperatureCelsius: 8.0,
        }),
      ];
      repo._qb.getMany.mockResolvedValue(proofs);

      const stats = await service.getDeliveryStatistics('rider-1');

      expect(stats.totalDeliveries).toBe(2);
      expect(stats.successfulDeliveries).toBe(2);
      expect(stats.successRate).toBe(100);
      expect(stats.temperatureCompliantDeliveries).toBe(1);
      expect(stats.temperatureComplianceRate).toBe(50);
      expect(stats.averageTemperatureCelsius).toBe(6);
    });

    it('returns null averageTemperature when no temperature data', async () => {
      repo._qb.getMany.mockResolvedValue([
        mockProof({ temperatureCelsius: null }),
      ]);
      const stats = await service.getDeliveryStatistics('rider-1');
      expect(stats.averageTemperatureCelsius).toBeNull();
    });

    it('returns zero rates when no deliveries', async () => {
      repo._qb.getMany.mockResolvedValue([]);
      const stats = await service.getDeliveryStatistics('rider-1');
      expect(stats.totalDeliveries).toBe(0);
      expect(stats.successRate).toBe(0);
      expect(stats.temperatureComplianceRate).toBe(0);
    });
  });

  describe('calculateSuccessRate', () => {
    it('returns 0 when total is 0', () => {
      expect(service.calculateSuccessRate(0, 0)).toBe(0);
    });

    it('returns 100 when all successful', () => {
      expect(service.calculateSuccessRate(5, 5)).toBe(100);
    });

    it('returns correct percentage', () => {
      expect(service.calculateSuccessRate(3, 4)).toBe(75);
    });
  });

  describe('create', () => {
    it('stores a verified proof when signature and digest references are valid', async () => {
      const dto = {
        deliveryId: 1001,
        orderId: 'order-1',
        requestId: 'request-1',
        riderId: 'rider-1',
        pickupTimestamp: '2024-01-15T09:00:00Z',
        deliveredAt: '2024-01-15T10:00:00Z',
        recipientName: 'John Doe',
        temperatureReadings: [4, 5],
        signerKeyId: 'delivery-proof-key-1',
        signerPublicKey: signerKeypair.publicKey(),
        signerRole: 'rider',
        signedAt: '2024-01-15T10:01:00Z',
        signature: '',
        evidenceDigestReferences: ['a'.repeat(64), 'b'.repeat(64)],
      };
      dto.signature = signPayload(dto);

      const result = await service.create(dto as any);

      expect(custodyService.assertCustodyComplete).toHaveBeenCalledWith('order-1');
      expect(result.verified).toBe(true);
      expect(result.signerPublicKey).toBe(signerKeypair.publicKey());
      expect(result.proofPayloadDigest).toBeDefined();
      expect(result.trustedTimestampAt).toBeInstanceOf(Date);
      expect(result.evidenceDigestReferences).toHaveLength(2);
    });

    it('rejects a proof with mismatched signature', async () => {
      const dto = {
        deliveryId: 1001,
        orderId: 'order-1',
        requestId: 'request-1',
        riderId: 'rider-1',
        pickupTimestamp: '2024-01-15T09:00:00Z',
        deliveredAt: '2024-01-15T10:00:00Z',
        recipientName: 'John Doe',
        temperatureReadings: [4, 5],
        signerKeyId: 'delivery-proof-key-1',
        signerPublicKey: signerKeypair.publicKey(),
        signerRole: 'rider',
        signedAt: '2024-01-15T10:01:00Z',
        signature: 'invalid',
        evidenceDigestReferences: ['a'.repeat(64)],
      };

      await expect(service.create(dto as any)).rejects.toThrow('Signature verification failed');
    });

    it('rejects a proof missing evidence digests', async () => {
      const dto = {
        deliveryId: 1001,
        orderId: 'order-1',
        requestId: 'request-1',
        riderId: 'rider-1',
        pickupTimestamp: '2024-01-15T09:00:00Z',
        deliveredAt: '2024-01-15T10:00:00Z',
        recipientName: 'John Doe',
        temperatureReadings: [4, 5],
        signerKeyId: 'delivery-proof-key-1',
        signerPublicKey: signerKeypair.publicKey(),
        signerRole: 'rider',
        signedAt: '2024-01-15T10:01:00Z',
        signature: 'invalid',
        evidenceDigestReferences: [],
      };

      await expect(service.create(dto as any)).rejects.toThrow(
        'At least one evidence digest reference is required',
      );
    });
  });
});
