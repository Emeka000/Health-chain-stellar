import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BloodRequestSagaEntity, SagaCompensationReason, SagaState } from '../entities/blood-request-saga.entity';
import { SagaCoordinatorService } from './saga-coordinator.service';

const mockInventory = { releaseStockByBankAndType: jest.fn(() => Promise.resolve()) };

function makeSaga(overrides: Partial<BloodRequestSagaEntity> = {}): BloodRequestSagaEntity {
  return {
    id: 'saga-1', requestId: 'req-1', correlationId: 'corr-1',
    state: SagaState.STARTED, compensationLog: [], compensationReason: null,
    context: {}, timeoutAt: new Date(Date.now() + 3_600_000),
    retryCount: 0, lastError: null, version: 1,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as BloodRequestSagaEntity;
}

describe('SagaCoordinatorService', () => {
  let service: SagaCoordinatorService;
  let sagaRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    const qb = {
      update: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn(() => Promise.resolve({ affected: 1 })),
      getMany: jest.fn(() => Promise.resolve([])),
    };
    sagaRepo = {
      create: jest.fn((d) => ({ ...d })),
      save: jest.fn((e) => Promise.resolve({ id: 'saga-1', version: 1, ...e })),
      findOne: jest.fn(() => Promise.resolve(null)),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      createQueryBuilder: jest.fn(() => qb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SagaCoordinatorService,
        { provide: getRepositoryToken(BloodRequestSagaEntity), useValue: sagaRepo },
        { provide: 'InventoryService', useValue: mockInventory },
      ],
    })
      .overrideProvider('InventoryService').useValue(mockInventory)
      .compile();

    service = module.get(SagaCoordinatorService);
    // inject inventory manually since NestJS token is class ref
    (service as any).inventoryService = mockInventory;
  });

  describe('start', () => {
    it('creates a new saga and returns it', async () => {
      const result = await service.start({ requestId: 'req-1' });
      expect(sagaRepo.save).toHaveBeenCalled();
      expect(result.state).toBe(SagaState.STARTED);
    });

    it('is idempotent — returns existing saga if already started', async () => {
      sagaRepo.findOne.mockResolvedValue(makeSaga());
      const result = await service.start({ requestId: 'req-1' });
      expect(sagaRepo.save).not.toHaveBeenCalled();
      expect(result.requestId).toBe('req-1');
    });
  });

  describe('advance', () => {
    it('advances state with optimistic locking', async () => {
      sagaRepo.findOne.mockResolvedValue(makeSaga());
      await service.advance('req-1', SagaState.INVENTORY_RESERVED);
      expect(sagaRepo.createQueryBuilder().execute).toHaveBeenCalled();
    });

    it('throws ConflictException on concurrent modification', async () => {
      sagaRepo.findOne.mockResolvedValue(makeSaga());
      sagaRepo.createQueryBuilder().execute.mockResolvedValue({ affected: 0 });
      await expect(service.advance('req-1', SagaState.INVENTORY_RESERVED))
        .rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when saga is in terminal state', async () => {
      sagaRepo.findOne.mockResolvedValue(makeSaga({ state: SagaState.SETTLED }));
      await expect(service.advance('req-1', SagaState.APPROVED))
        .rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when saga does not exist', async () => {
      sagaRepo.findOne.mockResolvedValue(null);
      await expect(service.advance('req-1', SagaState.APPROVED))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('compensate', () => {
    it('releases inventory and transitions to CANCELLED', async () => {
      sagaRepo.findOne.mockResolvedValue(makeSaga({
        state: SagaState.INVENTORY_RESERVED,
        context: { reservedItems: [{ bloodBankId: 'bank-1', bloodType: 'A+', quantity: 500 }] },
      }));
      await service.compensate('req-1', SagaCompensationReason.APPROVAL_REJECTED, 'rejected');
      expect(mockInventory.releaseStockByBankAndType).toHaveBeenCalledWith('bank-1', 'A+', 500);
      expect(sagaRepo.update).toHaveBeenCalledWith(
        { requestId: 'req-1' },
        expect.objectContaining({ state: SagaState.CANCELLED }),
      );
    });

    it('is idempotent — skips already-compensated steps', async () => {
      sagaRepo.findOne.mockResolvedValue(makeSaga({
        state: SagaState.INVENTORY_RESERVED,
        compensationLog: [{ step: 'release_inventory', appliedAt: new Date().toISOString(), success: true }],
        context: { reservedItems: [{ bloodBankId: 'bank-1', bloodType: 'A+', quantity: 500 }] },
      }));
      await service.compensate('req-1', SagaCompensationReason.TIMEOUT, 'timed out');
      expect(mockInventory.releaseStockByBankAndType).not.toHaveBeenCalled();
    });

    it('transitions to COMPENSATION_FAILED when inventory release throws', async () => {
      mockInventory.releaseStockByBankAndType.mockRejectedValueOnce(new Error('DB error'));
      sagaRepo.findOne.mockResolvedValue(makeSaga({
        state: SagaState.INVENTORY_RESERVED,
        context: { reservedItems: [{ bloodBankId: 'bank-1', bloodType: 'A+', quantity: 500 }] },
      }));
      await service.compensate('req-1', SagaCompensationReason.DISPATCH_FAILED, 'dispatch error');
      expect(sagaRepo.update).toHaveBeenCalledWith(
        { requestId: 'req-1' },
        expect.objectContaining({ state: SagaState.COMPENSATION_FAILED }),
      );
    });
  });

  describe('findByCorrelationId', () => {
    it('returns saga by correlation id', async () => {
      sagaRepo.findOne.mockResolvedValue(makeSaga());
      const result = await service.findByCorrelationId('corr-1');
      expect(result?.correlationId).toBe('corr-1');
    });
  });
});
