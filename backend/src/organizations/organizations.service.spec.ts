/// <reference types="jest" />
/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
jest.mock(
  '@nestjs/bull',
  () => ({
    InjectQueue: () => () => undefined,
  }),
  { virtual: true },
);

import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { SorobanService } from '../blockchain/services/soroban.service';
import { EmailProvider } from '../notifications/providers/email.provider';

import { OrganizationEntity } from './entities/organization.entity';
import { OrganizationVerificationStatus } from './enums/organization-verification-status.enum';
import { OrganizationRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  let service: OrganizationsService;
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    createActiveQueryBuilder: jest.Mock;
  };
  let emailProvider: { send: jest.Mock };
  let soroban: { submitTransactionAndWait: jest.Mock };
  let config: { get: jest.Mock };

  const sampleOrg: Partial<OrganizationEntity> = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Test Org',
    legalName: 'Test Org LLC',
    email: 'org@example.com',
    phone: '+2348012345678',
    address: null,
    licenseNumber: 'LIC-UNIQUE-1',
    status: OrganizationVerificationStatus.PENDING_VERIFICATION,
    licenseDocumentPath: '',
    certificateDocumentPath: '',
  };

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn(async (e) => ({ ...e })),
      find: jest.fn(),
      createActiveQueryBuilder: jest.fn(),
    };
    emailProvider = { send: jest.fn().mockResolvedValue(undefined) };
    soroban = {
      submitTransactionAndWait: jest
        .fn()
        .mockResolvedValue({ transactionHash: 'tx_mock_hash' }),
    };
    config = {
      get: jest.fn((key: string, def?: string) => {
        if (key === 'ORG_UPLOAD_BASE_DIR') return 'uploads/organizations';
        if (key === 'SOROBAN_ORG_REGISTRY_CONTRACT_ID') return 'C_REGISTRY';
        return def;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        OrganizationRepository,
        { provide: getRepositoryToken(OrganizationEntity), useValue: repo },
        { provide: EmailProvider, useValue: emailProvider },
        { provide: SorobanService, useValue: soroban },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(OrganizationsService);
  });

  describe('register', () => {
    it('rejects duplicate license number', async () => {
      repo.findOne.mockResolvedValueOnce({ id: 'x' });
      await expect(
        service.register(
          {
            name: 'A',
            legalName: 'A L',
            email: 'a@b.com',
            phone: '+2348012345678',
            licenseNumber: 'DUP',
          },
          {
            licenseDocument: [
              {
                mimetype: 'application/pdf',
                size: 100,
                buffer: Buffer.from('a'),
                originalname: 'a.pdf',
              } as Express.Multer.File,
            ],
            certificateDocument: [
              {
                mimetype: 'application/pdf',
                size: 100,
                buffer: Buffer.from('b'),
                originalname: 'b.pdf',
              } as Express.Multer.File,
            ],
          },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('approve', () => {
    it('throws when organization missing', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.approve('22222222-2222-2222-2222-222222222222', 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('approves pending org and calls blockchain + email', async () => {
      const pending = { ...sampleOrg } as OrganizationEntity;
      repo.findOne.mockResolvedValueOnce(pending);
      repo.save.mockImplementation(async (e) => e);

      const result = await service.approve(pending.id, 'admin-uuid');

      expect(soroban.submitTransactionAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          contractMethod: 'register_verified_organization',
          idempotencyKey: `org-verified:${pending.id}`,
        }),
      );
      expect(result.data.status).toBe(OrganizationVerificationStatus.APPROVED);
      expect(result.data.blockchainTxHash).toBe('tx_mock_hash');
      expect(result.data.blockchainAddress).toBe('C_REGISTRY');
      expect(emailProvider.send).toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('sets rejected status and emails', async () => {
      const pending = { ...sampleOrg } as OrganizationEntity;
      repo.findOne.mockResolvedValueOnce(pending);
      repo.save.mockImplementation(async (e) => e);

      const result = await service.reject(
        pending.id,
        { reason: 'Incomplete documentation' },
        'admin-uuid',
      );

      expect(result.data.status).toBe(OrganizationVerificationStatus.REJECTED);
      expect(result.data.rejectionReason).toBe('Incomplete documentation');
      expect(emailProvider.send).toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('returns only public verified org fields for public search', async () => {
      const queryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'org-1',
            name: 'Public Health Org',
            description: 'Regional provider',
            type: 'hospital',
            city: 'Lagos',
            state: 'Lagos',
            country: 'Nigeria',
            website: 'https://example.org',
            rating: 4.8,
            status: OrganizationVerificationStatus.APPROVED,
            isActive: true,
            email: 'secret@example.org',
            phoneNumber: '+2348000000000',
            licenseNumber: 'LIC-123',
            licenseDocumentPath: '/secret/license.pdf',
            certificateDocumentPath: '/secret/certificate.pdf',
            rejectionReason: 'internal note',
            verifiedByUserId: 'admin-1',
            blockchainTxHash: '0xabc',
            blockchainAddress: 'addr-123',
          },
        ]),
      };

      repo.createActiveQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.search({ query: 'health', page: 1, pageSize: 10 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({
          id: 'org-1',
          name: 'Public Health Org',
          description: 'Regional provider',
          type: 'hospital',
          city: 'Lagos',
          status: OrganizationVerificationStatus.APPROVED,
        }),
      );
      expect(result.data[0]).not.toHaveProperty('email');
      expect(result.data[0]).not.toHaveProperty('phoneNumber');
      expect(result.data[0]).not.toHaveProperty('licenseNumber');
      expect(result.data[0]).not.toHaveProperty('licenseDocumentPath');
      expect(result.data[0]).not.toHaveProperty('rejectionReason');
      expect(result.data[0]).not.toHaveProperty('verifiedByUserId');
      expect(result.data[0]).not.toHaveProperty('blockchainTxHash');
      expect(result.data[0]).not.toHaveProperty('blockchainAddress');
    });
  });
});
