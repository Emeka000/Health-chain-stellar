import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { InventoryService } from './inventory.service';
import { InventoryStockRepository } from './repositories/inventory-stock.repository';
import { InventoryStockEntity } from './entities/inventory-stock.entity';
import { ReservationAuditEntity } from './entities/reservation-audit.entity';
import { BloodRequestReservationEntity } from '../blood-requests/entities/blood-request-reservation.entity';
import { InventoryRepository } from './repositories/inventory.repository';

// ── Factory ───────────────────────────────────────────────────────────────────

const makeStock = (overrides: Partial<InventoryStockEntity> = {}): InventoryStockEntity =>
  ({
    id: 'stock-1',
    bloodBankId: 'bank-1',
    bloodType: 'O+',
    availableUnitsMl: 1000,
    reservedUnitsMl: 0,
    allocatedUnitsMl: 0,
    totalUnitsMl: 1000,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as InventoryStockEntity);

// ── Mock repository ───────────────────────────────────────────────────────────

const makeStockRepo = () => ({
  findById: jest.fn().mockResolvedValue(null),
  findByBankAndType: jest.fn().mockResolvedValue(null),
  findAndCount: jest.fn().mockResolvedValue([[], 0]),
  save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
  create: jest.fn().mockImplementation((dto) => ({ ...dto })),
  merge: jest.fn().mockImplementation((e, u) => ({ ...e, ...u })),
  remove: jest.fn().mockResolvedValue(undefined),
  getLowStock: jest.fn().mockResolvedValue([]),
  atomicDecrement: jest.fn().mockResolvedValue({ affected: 1 }),
  atomicIncrement: jest.fn().mockResolvedValue({ affected: 1 }),
  bumpVersion: jest.fn().mockResolvedValue({ affected: 1 }),
});

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('InventoryService', () => {
  let service: InventoryService;
  let stockRepo: ReturnType<typeof makeStockRepo>;

  beforeEach(async () => {
    stockRepo = makeStockRepo();

    const rawInventoryStockRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockImplementation((e: any) => Promise.resolve(e)),
      create: jest.fn().mockImplementation((d: any) => d),
    };
    const inventoryRepositoryMock = {
      getStockAggregationByBloodType: jest.fn().mockResolvedValue([]),
    };
    const auditRepoMock = {
      create: jest.fn((d: any) => d),
      save: jest.fn((e: any) => Promise.resolve(e)),
    };
    const reservationRepoMock = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: InventoryStockRepository, useValue: stockRepo },
        { provide: getRepositoryToken(InventoryStockEntity), useValue: rawInventoryStockRepoMock },
        { provide: InventoryRepository, useValue: inventoryRepositoryMock },
        { provide: getRepositoryToken(ReservationAuditEntity), useValue: auditRepoMock },
        { provide: getRepositoryToken(BloodRequestReservationEntity), useValue: reservationRepoMock },
      ],
    }).compile();

    service = module.get(InventoryService);
    jest.clearAllMocks();
  });

  // ── findAll ─────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated response with no filter', async () => {
      stockRepo.findAndCount.mockResolvedValue([[makeStock()], 1]);
      const result = await service.findAll();
      expect(result.data).toHaveLength(1);
      expect(result.pagination.totalCount).toBe(1);
    });

    it('passes bloodBankId filter when hospitalId is provided', async () => {
      stockRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.findAll('bank-1');
      expect(stockRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ bloodBankId: 'bank-1' }),
        expect.any(Number),
        expect.any(Number),
      );
    });
  });

  // ── findOne ─────────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the item when found', async () => {
      stockRepo.findById.mockResolvedValue(makeStock());
      const result = await service.findOne('stock-1', 'bank-1');
      expect(result.data.id).toBe('stock-1');
    });

    it('throws NotFoundException when not found', async () => {
      stockRepo.findById.mockResolvedValue(null);
      await expect(service.findOne('missing', 'bank-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── create ──────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a new stock record when none exists', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(null);
      await service.create({ hospitalId: 'bank-1', bloodType: 'A+', quantity: 500 }, 'bank-1');
      expect(stockRepo.create).toHaveBeenCalled();
      expect(stockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ bloodBankId: 'bank-1', availableUnitsMl: 500 }),
      );
      expect(stockRepo.save).toHaveBeenCalled();
    });

    it('merges into existing record when one already exists', async () => {
      const existing = makeStock();
      stockRepo.findByBankAndType.mockResolvedValue(existing);
      await service.create({ hospitalId: 'bank-1', bloodType: 'O+', quantity: 200 }, 'bank-1');
      expect(stockRepo.merge).toHaveBeenCalledWith(existing, { availableUnitsMl: 200 });
      expect(stockRepo.create).not.toHaveBeenCalled();
    });

    it('rejects creation for a different organization', async () => {
      await expect(
        service.create({ hospitalId: 'bank-2', bloodType: 'O+', quantity: 200 }, 'bank-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(stockRepo.findByBankAndType).not.toHaveBeenCalled();
    });
  });

  // ── update ──────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('throws NotFoundException when item does not exist', async () => {
      stockRepo.findById.mockResolvedValue(null);
      await expect(service.update('missing', {}, 'bank-1')).rejects.toThrow(NotFoundException);
    });

    it('merges and saves the updated entity', async () => {
      const stock = makeStock();
      stockRepo.findById.mockResolvedValue(stock);
      await service.update('stock-1', { quantity: 800 }, 'bank-1');
      expect(stockRepo.merge).toHaveBeenCalledWith(stock, { availableUnitsMl: 800 });
      expect(stockRepo.save).toHaveBeenCalled();
    });
  });

  // ── remove ──────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('throws NotFoundException when item does not exist', async () => {
      stockRepo.findById.mockResolvedValue(null);
      await expect(service.remove('missing', 'bank-1')).rejects.toThrow(NotFoundException);
    });

    it('calls stockRepo.remove on the found entity', async () => {
      stockRepo.findById.mockResolvedValue(makeStock());
      await service.remove('stock-1', 'bank-1');
      expect(stockRepo.remove).toHaveBeenCalled();
    });
  });

  // ── updateStock ─────────────────────────────────────────────────────────────

  describe('updateStock', () => {
    it('throws NotFoundException when item does not exist', async () => {
      stockRepo.findById.mockResolvedValue(null);
      await expect(service.updateStock('missing', 100, 'bank-1')).rejects.toThrow(NotFoundException);
    });

    it('sets availableUnitsMl and saves', async () => {
      const stock = makeStock();
      stockRepo.findById.mockResolvedValue(stock);
      await service.updateStock('stock-1', 750, 'bank-1');
      expect(stockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ availableUnitsMl: 750 }),
      );
    });
  });

  // ── getLowStockItems ────────────────────────────────────────────────────────

  describe('getLowStockItems', () => {
    it('delegates to stockRepo.getLowStock with the threshold', async () => {
      stockRepo.getLowStock.mockResolvedValue([makeStock({ availableUnitsMl: 5 })]);
      const result = await service.getLowStockItems(10);
      expect(stockRepo.getLowStock).toHaveBeenCalledWith(10);
      expect(result.data).toHaveLength(1);
    });
  });

  // ── reserveStockOrThrow ─────────────────────────────────────────────────────

  describe('reserveStockOrThrow', () => {
    it('throws ConflictException when quantity is zero', async () => {
      await expect(service.reserveStockOrThrow('bank-1', 'O+', 0)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when quantity is negative', async () => {
      await expect(service.reserveStockOrThrow('bank-1', 'O+', -1)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when no stock record exists', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(null);
      await expect(service.reserveStockOrThrow('bank-1', 'O+', 100)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws ConflictException when available units are insufficient', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(makeStock({ availableUnitsMl: 50 }));
      await expect(service.reserveStockOrThrow('bank-1', 'O+', 100)).rejects.toThrow(
        ConflictException,
      );
    });

    it('succeeds when atomicDecrement affects 1 row', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(makeStock());
      stockRepo.atomicDecrement.mockResolvedValue({ affected: 1 });
      await expect(service.reserveStockOrThrow('bank-1', 'O+', 100)).resolves.toBeUndefined();
    });

    it('retries once on version mismatch then throws ConflictException', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(makeStock());
      stockRepo.atomicDecrement.mockResolvedValue({ affected: 0 });
      await expect(service.reserveStockOrThrow('bank-1', 'O+', 100)).rejects.toThrow(
        ConflictException,
      );
      expect(stockRepo.findByBankAndType).toHaveBeenCalledTimes(2);
    });

    it('succeeds on second attempt after first version mismatch', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(makeStock());
      stockRepo.atomicDecrement
        .mockResolvedValueOnce({ affected: 0 })
        .mockResolvedValueOnce({ affected: 1 });
      await expect(service.reserveStockOrThrow('bank-1', 'O+', 100)).resolves.toBeUndefined();
    });
  });

  // ── restoreStockOrThrow ─────────────────────────────────────────────────────

  describe('restoreStockOrThrow', () => {
    it('throws ConflictException when quantity is zero', async () => {
      await expect(service.restoreStockOrThrow('bank-1', 'O+', 0)).rejects.toThrow(
        ConflictException,
      );
    });

    it('creates a new stock record with component when none exists', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(null);
      await service.restoreStockOrThrow('bank-1', 'O+', 200, 'PLATELETS' as any);
      expect(stockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ bloodBankId: 'bank-1', bloodType: 'O+', component: 'PLATELETS', availableUnitsMl: 200 }),
      );
      expect(stockRepo.save).toHaveBeenCalled();
    });

    it('succeeds when atomicIncrement affects 1 row', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(makeStock());
      stockRepo.atomicIncrement.mockResolvedValue({ affected: 1 });
      await expect(service.restoreStockOrThrow('bank-1', 'O+', 200)).resolves.toBeUndefined();
    });

    it('retries once on version mismatch then throws ConflictException', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(makeStock());
      stockRepo.atomicIncrement.mockResolvedValue({ affected: 0 });
      await expect(service.restoreStockOrThrow('bank-1', 'O+', 200)).rejects.toThrow(
        ConflictException,
      );
      expect(stockRepo.findByBankAndType).toHaveBeenCalledTimes(2);
    });
  });

  // ── commitFulfillmentStockOrThrow ───────────────────────────────────────────

  describe('commitFulfillmentStockOrThrow', () => {
    it('throws ConflictException when no stock record exists', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(null);
      await expect(
        service.commitFulfillmentStockOrThrow('bank-1', 'O+', 100),
      ).rejects.toThrow(ConflictException);
    });

    it('calls bumpVersion on the found stock record', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(makeStock());
      await service.commitFulfillmentStockOrThrow('bank-1', 'O+', 100);
      expect(stockRepo.bumpVersion).toHaveBeenCalledWith('stock-1');
    });
  });

  // ── releaseStockByBankAndType ───────────────────────────────────────────────

  describe('releaseStockByBankAndType', () => {
    it('delegates to restoreStockOrThrow', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(makeStock());
      stockRepo.atomicIncrement.mockResolvedValue({ affected: 1 });
      await service.releaseStockByBankAndType('bank-1', 'O+', 100);
      expect(stockRepo.atomicIncrement).toHaveBeenCalled();
    });
  });
});
