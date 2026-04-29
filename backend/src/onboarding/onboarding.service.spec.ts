import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OrganizationRepository } from '../organizations/organizations.repository';
import { OrganizationType } from '../organizations/enums/organization-type.enum';
import { ReadinessService } from '../readiness/readiness.service';
import { SorobanService } from '../blockchain/services/soroban.service';
import { DataSource } from 'typeorm';
import { ActivateOnboardingDto } from './dto/onboarding.dto';
import { PartnerOnboardingEntity } from './entities/partner-onboarding.entity';
import { OnboardingStatus, OnboardingStep } from './enums/onboarding.enum';
import { OnboardingService } from './onboarding.service';

const FULL_DATA = {
  [OnboardingStep.PROFILE]: { name: 'Org', legalName: 'Org Ltd', email: 'a@b.com', phone: '+1234567890' },
  [OnboardingStep.COMPLIANCE]: { licenseNumber: 'LIC-1', registrationNumber: 'REG-1', licenseDocumentUrl: 'https://x' },
  [OnboardingStep.CONTACTS]: { contactName: 'Alice', contactEmail: 'alice@b.com' },
  [OnboardingStep.SERVICE_AREAS]: { serviceAreas: ['Lagos'] },
  [OnboardingStep.WALLET]: { walletAddress: 'GXXX' },
};

const mockRepo = () => ({
  create: jest.fn((d) => ({ ...d, id: 'ob-1' })),
  save: jest.fn(async (e) => e),
  findOne: jest.fn(),
  find: jest.fn(async () => []),
});

const mockOrgRepo = () => ({
  create: jest.fn((d) => ({ ...d, id: 'org-1' })),
  save: jest.fn(async (e) => e),
});

const mockSoroban = () => ({
  verifyOrganization: jest.fn(async () => ({ transactionHash: 'tx-1' })),
});

const mockReadiness = () => ({
  isReady: jest.fn(async () => true),
});

describe('OnboardingService', () => {
  let service: OnboardingService;
  let repo: ReturnType<typeof mockRepo>;
  let orgRepo: ReturnType<typeof mockOrgRepo>;
  let dataSource: any;

  beforeEach(async () => {
    repo = mockRepo();
    orgRepo = mockOrgRepo();
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue({
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
          save: jest.fn(async (e) => e),
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: getRepositoryToken(PartnerOnboardingEntity), useValue: repo },
        { provide: OrganizationRepository, useValue: orgRepo },
        { provide: SorobanService, useValue: { submitTransaction: jest.fn(async () => 'job-1') } },
        { provide: ReadinessService, useValue: mockReadiness() },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    service = module.get(OnboardingService);
  });

  it('create returns a draft onboarding', async () => {
    const result = await service.create('user-1', { orgType: OrganizationType.HOSPITAL });
    expect(result.status).toBe(OnboardingStatus.DRAFT);
    expect(result.submittedBy).toBe('user-1');
  });

  it('saveStep merges step data', async () => {
    repo.findOne.mockResolvedValue({ id: 'ob-1', submittedBy: 'user-1', status: OnboardingStatus.DRAFT, data: {} });
    repo.save.mockImplementation(async (e) => e);
    const result = await service.saveStep('ob-1', 'user-1', {
      step: OnboardingStep.PROFILE,
      data: { name: 'Test' },
    });
    expect(result.data[OnboardingStep.PROFILE]).toEqual({ name: 'Test' });
  });

  it('saveStep throws if not draft', async () => {
    repo.findOne.mockResolvedValue({ id: 'ob-1', submittedBy: 'user-1', status: OnboardingStatus.SUBMITTED, data: {} });
    await expect(service.saveStep('ob-1', 'user-1', { step: OnboardingStep.PROFILE, data: {} }))
      .rejects.toThrow(BadRequestException);
  });

  it('submit throws when required fields missing', async () => {
    repo.findOne.mockResolvedValue({ id: 'ob-1', submittedBy: 'user-1', status: OnboardingStatus.DRAFT, data: {} });
    await expect(service.submit('ob-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('submit succeeds with complete data', async () => {
    repo.findOne.mockResolvedValue({ id: 'ob-1', submittedBy: 'user-1', status: OnboardingStatus.DRAFT, data: FULL_DATA });
    repo.save.mockImplementation(async (e) => e);
    const result = await service.submit('ob-1', 'user-1');
    expect(result.status).toBe(OnboardingStatus.SUBMITTED);
  });

  it('review approves a submitted onboarding', async () => {
    repo.findOne.mockResolvedValue({ id: 'ob-1', status: OnboardingStatus.SUBMITTED });
    repo.save.mockImplementation(async (e) => e);
    const result = await service.review('ob-1', 'admin-1', { decision: 'approved' });
    expect(result.status).toBe(OnboardingStatus.APPROVED);
    expect(result.reviewedBy).toBe('admin-1');
  });

  it('review throws if not submitted', async () => {
    repo.findOne.mockResolvedValue({ id: 'ob-1', status: OnboardingStatus.DRAFT });
    await expect(service.review('ob-1', 'admin-1', { decision: 'approved' })).rejects.toThrow(BadRequestException);
  });

  it('activate creates org and sets ACTIVATING status', async () => {
    repo.findOne.mockResolvedValue({ id: 'ob-1', status: OnboardingStatus.APPROVED, orgType: OrganizationType.HOSPITAL, data: FULL_DATA });
    const dto: ActivateOnboardingDto = { walletAddress: 'GXXX', licenseNumber: 'LIC-1' };
    const result = await service.activate('ob-1', 'admin-1', dto);
    
    expect(result.status).toBe(OnboardingStatus.ACTIVATING);
    expect(result.activationTxId).toBe('job-1');
    expect(dataSource.createQueryRunner().commitTransaction).toHaveBeenCalled();
  });

  it('activate throws if not approved', async () => {
    repo.findOne.mockResolvedValue({ id: 'ob-1', status: OnboardingStatus.SUBMITTED });
    await expect(service.activate('ob-1', 'admin-1', { walletAddress: 'G', licenseNumber: 'L' }))
      .rejects.toThrow(BadRequestException);
  });

  it('activate throws if readiness checklist is not signed off', async () => {
    repo.findOne.mockResolvedValue({ id: 'ob-1', status: OnboardingStatus.APPROVED, orgType: OrganizationType.HOSPITAL, data: FULL_DATA });
    const notReadyMod = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: getRepositoryToken(PartnerOnboardingEntity), useValue: repo },
        { provide: OrganizationRepository, useValue: orgRepo },
        { provide: SorobanService, useValue: { submitTransaction: jest.fn() } },
        { provide: ReadinessService, useValue: { isReady: jest.fn(async () => false) } },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    const svc = notReadyMod.get(OnboardingService);
    await expect(svc.activate('ob-1', 'admin-1', { walletAddress: 'G', licenseNumber: 'L' }))
      .rejects.toThrow(BadRequestException);
  });

  it('activate rolls back if blockchain submission fails', async () => {
    const soroban = { submitTransaction: jest.fn(async () => { throw new Error('queue fail'); }) };
    const mod = await Test.createTestingModule({
      providers: [
        OnboardingService,
        { provide: getRepositoryToken(PartnerOnboardingEntity), useValue: repo },
        { provide: OrganizationRepository, useValue: orgRepo },
        { provide: SorobanService, useValue: soroban },
        { provide: ReadinessService, useValue: mockReadiness() },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();
    const svc = mod.get(OnboardingService);
    repo.findOne.mockResolvedValue({ id: 'ob-1', status: OnboardingStatus.APPROVED, orgType: OrganizationType.HOSPITAL, data: FULL_DATA });
    
    await expect(svc.activate('ob-1', 'admin-1', { walletAddress: 'GXXX', licenseNumber: 'LIC-1' }))
      .rejects.toThrow('queue fail');
    
    expect(dataSource.createQueryRunner().rollbackTransaction).toHaveBeenCalled();
  });
});
