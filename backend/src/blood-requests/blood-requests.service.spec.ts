import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';

import { UserRole } from '../auth/enums/user-role.enum';
import { SorobanService } from '../blockchain/services/soroban.service';
import { CompensationService } from '../common/compensation/compensation.service';
import {
  BloodRequestIrrecoverableError,
  CompensationAction,
} from '../common/errors/app-errors';
import { InventoryService } from '../inventory/inventory.service';
import { BloodRequestsService } from './blood-requests.service';
import { CreateBloodRequestDto } from './dto/create-blood-request.dto';
import { BloodRequestItemEntity } from './entities/blood-request-item.entity';
import { BloodRequestEntity } from './entities/blood-request.entity';
import { RequestStatusHistoryEntity } from './entities/request-status-history.entity';
import { BloodRequestStatus } from './enums/blood-request-status.enum';
import { BLOOD_REQUEST_QUEUE } from './enums/request-urgency.enum';
import { PermissionsService } from '../auth/permissions.service';
import { BloodRequestChainService } from './services/blood-request-chain.service';
import { BloodRequestEmailService } from './services/blood-request-email.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

const savedRequest = (overrides = {}): BloodRequestEntity =>
  ({
    id: 'req-uuid',
    requestNumber: 'BR-123-ABC',
    hospitalId: 'hosp-1',
    status: BloodRequestStatus.PENDING,
    blockchainTxHash: 'tx-hash-abc',
    urgency: 'ROUTINE',
    items: [{ bloodType: 'A+', component: 'WHOLE_BLOOD', quantityMl: 450, priority: 'NORMAL' }],
    requiredByTimestamp: Math.floor((Date.now() + 86400000) / 1000),
    createdTimestamp: Math.floor(Date.now() / 1000),
    ...overrides,
  } as BloodRequestEntity);

const validDto = (): CreateBloodRequestDto => ({
  hospitalId: 'hosp-1',
  requiredBy: new Date(Date.now() + 86400000).toISOString(),
  deliveryAddress: '123 Main St',
  notes: undefined,
  urgency: 'ROUTINE' as any,
  items: [{ bloodBankId: 'bank-1', bloodType: 'A+', quantityMl: 450 } as any],
});

const adminUser = { id: 'user-1', role: UserRole.ADMIN, email: 'admin@test.com' };

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockBloodRequestRepo = {
  exist: jest.fn().mockResolvedValue(false),
  create: jest.fn().mockImplementation((dto) => dto),
  save: jest.fn().mockImplementation((e) => Promise.resolve(savedRequest(e))),
};

const mockItemRepo = {
  create: jest
    .fn()
    .mockImplementation((dto: Partial<BloodRequestItemEntity>) => dto),
};

const mockRequestStatusHistoryRepo = {
  create: jest
    .fn()
    .mockImplementation((dto: Partial<RequestStatusHistoryEntity>) => dto),
};

const mockInventoryService = {
  findByBankAndBloodType: jest
    .fn()
    .mockResolvedValue({ availableUnits: 10, version: 1 }),
  reserveStockOrThrow: jest.fn().mockResolvedValue(undefined),
  releaseStockByBankAndType: jest.fn().mockResolvedValue(undefined),
};

const mockChainService = {
  submitToChain: jest.fn().mockResolvedValue('tx-hash-abc'),
};

const mockEmailService = {
  sendCreationConfirmation: jest.fn().mockResolvedValue(undefined),
};

const mockPermissionsService = {
  assertIsAdminOrSelf: jest.fn(),
};

const mockQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-id' }),
};

describe('BloodRequestsService', () => {
  let service: BloodRequestsService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BloodRequestsService,
        { provide: getRepositoryToken(BloodRequestEntity), useValue: mockBloodRequestRepo },
        { provide: getRepositoryToken(BloodRequestItemEntity), useValue: mockItemRepo },
        { provide: getRepositoryToken(RequestStatusHistoryEntity), useValue: mockRequestStatusHistoryRepo },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: BloodRequestChainService, useValue: mockChainService },
        { provide: BloodRequestEmailService, useValue: mockEmailService },
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: getQueueToken(BLOOD_REQUEST_QUEUE), useValue: mockQueue },
        { provide: SorobanService, useValue: {} },
        { provide: CompensationService, useValue: {} },
        { provide: 'TriageScoringService', useValue: {} }, // Use string if not imported
      ],
    }).compile();

    service = module.get(BloodRequestsService);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  describe('create — happy path', () => {
    it('delegates chain submission to BloodRequestChainService', async () => {
      await service.create(validDto(), adminUser as any);
      expect(mockChainService.submitToChain).toHaveBeenCalled();
    });

    it('persists the request entity with PENDING status and tx hash', async () => {
      const result = await service.create(validDto(), adminUser as any);
      expect(mockBloodRequestRepo.save).toHaveBeenCalled();
      expect(result.data.status).toBe(BloodRequestStatus.PENDING);
    });
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  describe('create — validation', () => {
    it('throws BadRequestException when requiredBy is in the past', async () => {
      const dto = { ...validDto(), requiredBy: new Date(Date.now() - 1000).toISOString() };
      await expect(service.create(dto as any, adminUser as any)).rejects.toThrow(BadRequestException);
    });
  });
});
