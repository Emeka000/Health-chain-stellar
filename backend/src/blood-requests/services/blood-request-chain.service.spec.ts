import { Test, TestingModule } from '@nestjs/testing';

import { SorobanService } from '../../blockchain/services/soroban.service';
import { CompensationService } from '../../common/compensation/compensation.service';
import {
  BloodRequestIrrecoverableError,
  CompensationAction,
} from '../../common/errors/app-errors';
import { InventoryService } from '../../inventory/inventory.service';
import { EmailProvider } from '../../notifications/providers/email.provider';

import { BloodRequestChainService, ReservedItem } from './blood-request-chain.service';

const reserved: ReservedItem[] = [
  { bloodBankId: 'bank-1', bloodType: 'A+', quantity: 450 },
  { bloodBankId: 'bank-2', bloodType: 'O-', quantity: 200 },
];

describe('BloodRequestChainService', () => {
  let service: BloodRequestChainService;

  const mockSoroban = {
    submitTransactionAndWait: jest.fn().mockResolvedValue({ transactionHash: 'tx-abc' }),
  };

  const mockCompensation = {
    compensate: jest.fn().mockResolvedValue({
      applied: [CompensationAction.REVERT_INVENTORY],
      failed: [],
      failureRecordId: 'rec-1',
    }),
  };

  const mockInventory = {
    releaseStockByBankAndType: jest.fn().mockResolvedValue(undefined),
  };

  const mockEmail = {
    send: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BloodRequestChainService,
        { provide: SorobanService, useValue: mockSoroban },
        { provide: CompensationService, useValue: mockCompensation },
        { provide: InventoryService, useValue: mockInventory },
        { provide: EmailProvider, useValue: mockEmail },
      ],
    }).compile();

    service = module.get(BloodRequestChainService);
  });

  describe('submitToChain — success', () => {
    it('returns the transaction hash from Soroban', async () => {
      const hash = await service.submitToChain('BR-1', 'hosp-1', reserved, 'u@test.com');
      expect(hash).toBe('tx-abc');
    });

    it('calls submitTransactionAndWait with correct contract method and idempotency key', async () => {
      await service.submitToChain('BR-1', 'hosp-1', reserved, 'u@test.com');
      expect(mockSoroban.submitTransactionAndWait).toHaveBeenCalledWith(
        expect.objectContaining({
          contractMethod: 'create_blood_request',
          idempotencyKey: 'blood-request:BR-1',
        }),
      );
    });
  });

  describe('submitToChain — Soroban failure triggers compensation', () => {
    beforeEach(() => {
      mockSoroban.submitTransactionAndWait.mockRejectedValueOnce(new Error('RPC down'));
    });

    it('throws BloodRequestIrrecoverableError', async () => {
      await expect(
        service.submitToChain('BR-1', 'hosp-1', reserved, 'u@test.com'),
      ).rejects.toBeInstanceOf(BloodRequestIrrecoverableError);
    });

    it('calls compensate with one REVERT_INVENTORY handler per reserved item', async () => {
      await expect(
        service.submitToChain('BR-1', 'hosp-1', reserved, 'u@test.com'),
      ).rejects.toThrow();

      const [, handlers] = mockCompensation.compensate.mock.calls[0];
      const revertHandlers = handlers.filter(
        (h: any) => h.action === CompensationAction.REVERT_INVENTORY,
      );
      expect(revertHandlers).toHaveLength(reserved.length);
    });

    it('includes NOTIFY_USER, NOTIFY_ADMIN, and FLAG_FOR_REVIEW handlers', async () => {
      await expect(
        service.submitToChain('BR-1', 'hosp-1', reserved, 'u@test.com'),
      ).rejects.toThrow();

      const [, handlers] = mockCompensation.compensate.mock.calls[0];
      const actions = handlers.map((h: any) => h.action);
      expect(actions).toContain(CompensationAction.NOTIFY_USER);
      expect(actions).toContain(CompensationAction.NOTIFY_ADMIN);
      expect(actions).toContain(CompensationAction.FLAG_FOR_REVIEW);
    });

    it('attaches failureRecordId from compensation result to error context', async () => {
      let caught: BloodRequestIrrecoverableError | undefined;
      try {
        await service.submitToChain('BR-1', 'hosp-1', reserved, 'u@test.com');
      } catch (e) {
        caught = e as BloodRequestIrrecoverableError;
      }
      expect(caught?.context['failureRecordId']).toBe('rec-1');
    });

    it('REVERT_INVENTORY handler calls releaseStockByBankAndType for each item', async () => {
      await expect(
        service.submitToChain('BR-1', 'hosp-1', reserved, 'u@test.com'),
      ).rejects.toThrow();

      const [, handlers] = mockCompensation.compensate.mock.calls[0];
      const revertHandlers = handlers.filter(
        (h: any) => h.action === CompensationAction.REVERT_INVENTORY,
      );

      // Execute each handler to verify it calls the inventory service
      for (const h of revertHandlers) {
        await h.execute();
      }

      expect(mockInventory.releaseStockByBankAndType).toHaveBeenCalledWith('bank-1', 'A+', 450);
      expect(mockInventory.releaseStockByBankAndType).toHaveBeenCalledWith('bank-2', 'O-', 200);
    });

    it('NOTIFY_USER handler returns false (not true) when email send fails', async () => {
      mockEmail.send.mockRejectedValueOnce(new Error('SMTP down'));

      await expect(
        service.submitToChain('BR-1', 'hosp-1', reserved, 'u@test.com'),
      ).rejects.toThrow();

      const [, handlers] = mockCompensation.compensate.mock.calls[0];
      const notifyHandler = handlers.find(
        (h: any) => h.action === CompensationAction.NOTIFY_USER,
      );
      const result = await notifyHandler.execute();
      expect(result).toBe(false);
    });
  });
});
