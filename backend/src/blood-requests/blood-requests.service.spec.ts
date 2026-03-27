import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { SorobanService } from '../blockchain/services/soroban.service';
import { CompensationService } from '../common/compensation/compensation.service';
import {
  BloodRequestIrrecoverableError,
  CompensationAction,
} from '../common/errors/app-errors';
import { InventoryService } from '../inventory/inventory.service';
import { EmailProvider } from '../notifications/providers/email.provider';

import { BloodRequestsService } from './blood-requests.service';
import { BloodRequestItemEntity } from './entities/blood-request-item.entity';
import { BloodRequestEntity } from './entities/blood-request.entity';
import { BloodRequestStatus } from './enums/blood-request-status.enum';

const mockBloodRequestRepo = {
  exist: jest.fn().mockResolvedValue(false),
  create: jest.fn().mockImplementation((dto) => dto),
  save: jest
    .fn()
    .mockImplementation((e) =>
      Promise.resolve({ ...e, id: 'req-uuid', items: e.items ?? [] }),
    ),
};

const mockBloodRequestItemRepo = {
  create: jest.fn().mockImplementation((dto) => dto),
};

const mockInventoryService = {
  reserveStockOrThrow: jest.fn().mockResolvedValue(undefined),
  releaseStockByBankAndType: jest.fn().mockResolvedValue(undefined),
};

const mockSorobanService = {
  submitTransactionAndWait: jest
    .fn()
    .mockResolvedValue({ transactionHash: 'tx-hash-abc' }),
};

const mockEmailProvider = {
  send: jest.fn().mockResolvedValue(undefined),
};

const mockCompensationService = {
  compensate: jest.fn().mockResolvedValue({
    applied: [
      CompensationAction.REVERT_INVENTORY,
      CompensationAction.NOTIFY_USER,
    ],
    failed: [],
    failureRecordId: 'record-uuid',
  }),
};

const validDto = {
  hospitalId: 'hosp-1',
  requiredBy: new Date(Date.now() + 86400000).toISOString(),
  deliveryAddress: '123 Main St',
  notes: null,
  items: [{ bloodBankId: 'bank-1', bloodType: 'A+', quantity: 2 }],
};

const adminUser = { id: 'hosp-1', role: 'admin', email: 'admin@test.com' };

describe('BloodRequestsService', () => {
  let service: BloodRequestsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BloodRequestsService,
        {
          provide: getRepositoryToken(BloodRequestEntity),
          useValue: mockBloodRequestRepo,
        },
        {
          provide: getRepositoryToken(BloodRequestItemEntity),
          useValue: mockBloodRequestItemRepo,
        },
        { provide: InventoryService, useValue: mockInventoryService },
        { provide: SorobanService, useValue: mockSorobanService },
        { provide: EmailProvider, useValue: mockEmailProvider },
        { provide: CompensationService, useValue: mockCompensationService },
      ],
    }).compile();

    service = module.get(BloodRequestsService);
  });

  describe('create — happy path', () => {
    it('reserves inventory, submits chain tx, saves entity, sends email', async () => {
      const result = await service.create(validDto as any, adminUser);

      expect(mockInventoryService.reserveStockOrThrow).toHaveBeenCalledWith(
        'bank-1',
        'A+',
        2,
      );
      expect(mockSorobanService.submitTransactionAndWait).toHaveBeenCalledWith(
        expect.objectContaining({ contractMethod: 'create_blood_request' }),
      );
      expect(mockBloodRequestRepo.save).toHaveBeenCalled();
      expect(mockEmailProvider.send).toHaveBeenCalled();
      expect(result.data.status).toBe(BloodRequestStatus.PENDING);
      expect(result.data.blockchainTxHash).toBe('tx-hash-abc');
    });
  });

  describe('create — irrecoverable blockchain failure', () => {
    beforeEach(() => {
      mockSorobanService.submitTransactionAndWait.mockRejectedValueOnce(
        new Error('Soroban RPC unreachable'),
      );
    });

    it('throws BloodRequestIrrecoverableError', async () => {
      await expect(
        service.create(validDto as any, adminUser),
      ).rejects.toBeInstanceOf(BloodRequestIrrecoverableError);
    });

    it('calls compensate with REVERT_INVENTORY and NOTIFY_USER handlers', async () => {
      await expect(
        service.create(validDto as any, adminUser),
      ).rejects.toThrow();

      expect(mockCompensationService.compensate).toHaveBeenCalledTimes(1);
      const [error, handlers] =
        mockCompensationService.compensate.mock.calls[0];

      expect(error).toBeInstanceOf(BloodRequestIrrecoverableError);
      const actions = handlers.map((h: any) => h.action);
      expect(actions).toContain(CompensationAction.REVERT_INVENTORY);
      expect(actions).toContain(CompensationAction.NOTIFY_USER);
      expect(actions).toContain(CompensationAction.NOTIFY_ADMIN);
      expect(actions).toContain(CompensationAction.FLAG_FOR_REVIEW);
    });

    it('does NOT double-release inventory (compensation already handled it)', async () => {
      await expect(
        service.create(validDto as any, adminUser),
      ).rejects.toThrow();

      // releaseStockByBankAndType should NOT be called directly by the outer catch
      expect(
        mockInventoryService.releaseStockByBankAndType,
      ).not.toHaveBeenCalled();
    });

    it('attaches failureRecordId to error context', async () => {
      let caughtError: BloodRequestIrrecoverableError | undefined;
      try {
        await service.create(validDto as any, adminUser);
      } catch (e) {
        caughtError = e as BloodRequestIrrecoverableError;
      }

      expect(caughtError?.context['failureRecordId']).toBe('record-uuid');
    });
  });

  describe('create — inventory reservation failure (recoverable path)', () => {
    it('releases already-reserved items on partial failure', async () => {
      // First item succeeds, second throws
      mockInventoryService.reserveStockOrThrow
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Insufficient stock'));

      const dtoWithTwo = {
        ...validDto,
        items: [
          { bloodBankId: 'bank-1', bloodType: 'A+', quantity: 2 },
          { bloodBankId: 'bank-2', bloodType: 'B-', quantity: 1 },
        ],
      };

      await expect(
        service.create(dtoWithTwo as any, adminUser),
      ).rejects.toThrow();

      // The outer catch should release the first reservation
      expect(
        mockInventoryService.releaseStockByBankAndType,
      ).toHaveBeenCalledWith('bank-1', 'A+', 2);
    });
  });
});
