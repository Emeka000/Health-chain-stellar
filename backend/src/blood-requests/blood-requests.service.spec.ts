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

const validDto = () => ({
  hospitalId: 'hosp-1',
  requiredBy: new Date(Date.now() + 86400000).toISOString(),
  deliveryAddress: '123 Main St',
  notes: null,
  urgency: 'ROUTINE',
  items: [{ bloodBankId: 'bank-1', bloodType: 'A+', quantity: 450 }],
});

const adminUser = { id: 'user-1', role: 'admin', email: 'admin@test.com' };

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockBloodRequestRepo = {
  exist: jest.fn().mockResolvedValue(false),
  create: jest.fn().mockImplementation((dto) => dto),
  save: jest.fn().mockImplementation((e) => Promise.resolve(savedRequest(e))),
};

const mockBloodRequestItemRepo = {
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

const validDto: CreateBloodRequestDto = {
  hospitalId: 'hosp-1',
  requiredBy: new Date(Date.now() + 86400000).toISOString(),
  deliveryAddress: '123 Main St',
  items: [{ bloodBankId: 'bank-1', bloodType: 'A+', quantity: 2 }],
};

const adminUser = {
  id: 'hosp-1',
  role: UserRole.ADMIN,
  email: 'admin@test.com',
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
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: BloodRequestChainService, useValue: mockChainService },
        { provide: BloodRequestEmailService, useValue: mockEmailService },
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: getQueueToken(BLOOD_REQUEST_QUEUE), useValue: mockQueue },
      ],
    }).compile();

    service = module.get(BloodRequestsService);
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  describe('create — happy path', () => {
    it('reserves inventory, submits chain tx, saves entity, sends email', async () => {
      const result = await service.create(validDto, adminUser);

    it('delegates chain submission to BloodRequestChainService', async () => {
      await service.create(validDto() as any, adminUser);
      expect(mockChainService.submitToChain).toHaveBeenCalledWith(
        expect.stringMatching(/^BR-/),
        'hosp-1',
        [{ bloodBankId: 'bank-1', bloodType: 'A+', quantity: 450 }],
        adminUser.email,
      );
    });

    it('persists the request entity with PENDING status and tx hash', async () => {
      const result = await service.create(validDto() as any, adminUser);
      expect(mockBloodRequestRepo.save).toHaveBeenCalled();
      expect(result.data.status).toBe(BloodRequestStatus.PENDING);
      expect(result.data.blockchainTxHash).toBe('tx-hash-abc');
    });

    it('enqueues a process-request job', async () => {
      await service.create(validDto() as any, adminUser);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'process-request',
        expect.objectContaining({ requestId: expect.any(String) }),
        expect.any(Object),
      );
    });

    it('sends a creation confirmation email', async () => {
      await service.create(validDto() as any, adminUser);
      expect(mockEmailService.sendCreationConfirmation).toHaveBeenCalledWith(
        adminUser.email,
        expect.objectContaining({ status: BloodRequestStatus.PENDING }),
      );
    });

    it('falls back to hospitalId as bloodBankId when item has none', async () => {
      const dto = validDto();
      dto.items = [{ bloodType: 'B+', quantity: 200 } as any];
      await service.create(dto as any, adminUser);
      expect(mockInventoryService.reserveStockOrThrow).toHaveBeenCalledWith('hosp-1', 'B+', 200);
    });
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  describe('create — validation', () => {
    it('throws BadRequestException when requiredBy is in the past', async () => {
      const dto = { ...validDto(), requiredBy: new Date(Date.now() - 1000).toISOString() };
      await expect(service.create(dto as any, adminUser)).rejects.toThrow(BadRequestException);
    });

      expect(error).toBeInstanceOf(BloodRequestIrrecoverableError);
      const actions = handlers.map((handler) => handler.action);
      expect(actions).toContain(CompensationAction.REVERT_INVENTORY);
      expect(actions).toContain(CompensationAction.NOTIFY_USER);
      expect(actions).toContain(CompensationAction.NOTIFY_ADMIN);
      expect(actions).toContain(CompensationAction.FLAG_FOR_REVIEW);
    });

    it('throws BadRequestException when item has no quantity', async () => {
      const dto = { ...validDto(), items: [{ bloodBankId: 'bank-1', bloodType: 'A+' }] };
      await expect(service.create(dto as any, adminUser)).rejects.toThrow(BadRequestException);
    });
  });

  // ── Irrecoverable chain failure ─────────────────────────────────────────────

  describe('create — irrecoverable chain failure', () => {
    beforeEach(() => {
      mockChainService.submitToChain.mockRejectedValueOnce(
        new BloodRequestIrrecoverableError('chain failed', {}, new Error('rpc down')),
      );
    });

    it('attaches failureRecordId to error context', async () => {
      let caughtError: BloodRequestIrrecoverableError | undefined;
      try {
        await service.create(validDto, adminUser);
      } catch (e) {
        if (e instanceof BloodRequestIrrecoverableError) {
          caughtError = e;
        }
      }

    it('does NOT call releaseStockByBankAndType (compensation already handled it)', async () => {
      await expect(service.create(validDto() as any, adminUser)).rejects.toThrow();
      expect(mockInventoryService.releaseStockByBankAndType).not.toHaveBeenCalled();
    });
  });

  // ── Recoverable inventory failure ───────────────────────────────────────────

  describe('create — partial inventory reservation failure', () => {
    it('releases already-reserved items in reverse order', async () => {
      mockInventoryService.reserveStockOrThrow
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Insufficient stock'));

      const dto = {
        ...validDto(),
        items: [
          { bloodBankId: 'bank-1', bloodType: 'A+', quantity: 450 },
          { bloodBankId: 'bank-2', bloodType: 'B-', quantity: 200 },
        ],
      };

      await expect(service.create(dto as any, adminUser)).rejects.toThrow();
      expect(mockInventoryService.releaseStockByBankAndType).toHaveBeenCalledWith('bank-1', 'A+', 450);
    });
  });

  // ── Hospital role authorization ─────────────────────────────────────────────

  describe('create — hospital role authorization', () => {
    it('calls assertIsAdminOrSelf for HOSPITAL role', async () => {
      const hospitalUser = { id: 'hosp-1', role: 'HOSPITAL', email: 'h@test.com' };
      await service.create(validDto() as any, hospitalUser);
      expect(mockPermissionsService.assertIsAdminOrSelf).toHaveBeenCalledWith(
        hospitalUser,
        'hosp-1',
        expect.any(String),
      );
    });

    it('skips authorization check for admin role', async () => {
      await service.create(validDto() as any, adminUser);
      expect(mockPermissionsService.assertIsAdminOrSelf).not.toHaveBeenCalled();
    });
  });

  // ── Request number uniqueness ───────────────────────────────────────────────

  describe('allocateRequestNumber', () => {
    it('retries when a collision is detected', async () => {
      mockBloodRequestRepo.exist
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false);

      await service.create(validDto() as any, adminUser);
      expect(mockBloodRequestRepo.exist).toHaveBeenCalledTimes(3);
    });

    it('throws after 12 consecutive collisions', async () => {
      mockBloodRequestRepo.exist.mockResolvedValue(true);
      await expect(service.create(validDto() as any, adminUser)).rejects.toThrow(
        'Unable to allocate a unique request number',
      );
    });
  });
});
