import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BloodRequestReservationEntity, ReservationStatus } from '../blood-requests/entities/blood-request-reservation.entity';
import { ReservationAuditEntity } from './entities/reservation-audit.entity';
import { InventoryStockEntity } from './entities/inventory-stock.entity';
import { InventoryStockRepository } from './repositories/inventory-stock.repository';
import { InventoryService } from './inventory.service';

function makeStock(available = 1000, version = 1): InventoryStockEntity {
  return { id: 'stock-1', bloodBankId: 'bank-1', bloodType: 'A+', component: 'WHOLE_BLOOD' as any,
    totalUnitsMl: available, availableUnitsMl: available, reservedUnitsMl: 0, allocatedUnitsMl: 0,
    version, createdAt: new Date(), updatedAt: new Date() } as InventoryStockEntity;
}

describe('InventoryService — reservation race conditions (#615)', () => {
  let service: InventoryService;
  let stockRepo: Record<string, jest.Mock>;
  let auditRepo: Record<string, jest.Mock>;
  let reservationRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    stockRepo = {
      findByBankAndType: jest.fn(() => Promise.resolve(makeStock())),
      findById: jest.fn(() => Promise.resolve(makeStock())),
      findAndCount: jest.fn(() => Promise.resolve([[], 0])),
      save: jest.fn((e) => Promise.resolve(e)),
      create: jest.fn((d) => d),
      merge: jest.fn((e, d) => ({ ...e, ...d })),
      remove: jest.fn(() => Promise.resolve()),
      getLowStock: jest.fn(() => Promise.resolve([])),
      atomicDecrement: jest.fn(() => Promise.resolve({ affected: 1 })),
      atomicIncrement: jest.fn(() => Promise.resolve({ affected: 1 })),
      bumpVersion: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    auditRepo = {
      create: jest.fn((d) => d),
      save: jest.fn((e) => Promise.resolve(e)),
    };

    const qb = {
      update: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn(() => Promise.resolve({ affected: 1 })),
    };
    reservationRepo = {
      find: jest.fn(() => Promise.resolve([])),
      createQueryBuilder: jest.fn(() => qb),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: InventoryStockRepository, useValue: stockRepo },
        { provide: getRepositoryToken(ReservationAuditEntity), useValue: auditRepo },
        { provide: getRepositoryToken(BloodRequestReservationEntity), useValue: reservationRepo },
      ],
    }).compile();

    service = module.get(InventoryService);
  });

  describe('reserveStockOrThrow — optimistic locking', () => {
    it('succeeds when stock is available and version matches', async () => {
      await expect(service.reserveStockOrThrow('bank-1', 'A+', 500)).resolves.toBeUndefined();
      expect(stockRepo.atomicDecrement).toHaveBeenCalledWith('stock-1', 1, 500);
    });

    it('retries once on version conflict then succeeds', async () => {
      stockRepo.atomicDecrement
        .mockResolvedValueOnce({ affected: 0 }) // first attempt: version conflict
        .mockResolvedValueOnce({ affected: 1 }); // second attempt: success
      await expect(service.reserveStockOrThrow('bank-1', 'A+', 500)).resolves.toBeUndefined();
      expect(stockRepo.atomicDecrement).toHaveBeenCalledTimes(2);
    });

    it('throws ConflictException after two consecutive version conflicts', async () => {
      stockRepo.atomicDecrement.mockResolvedValue({ affected: 0 });
      await expect(service.reserveStockOrThrow('bank-1', 'A+', 500))
        .rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when stock is insufficient', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(makeStock(100));
      await expect(service.reserveStockOrThrow('bank-1', 'A+', 500))
        .rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when no inventory record exists', async () => {
      stockRepo.findByBankAndType.mockResolvedValue(null);
      await expect(service.reserveStockOrThrow('bank-1', 'A+', 500))
        .rejects.toThrow(ConflictException);
    });

    it('writes audit record when requestId is provided', async () => {
      await service.reserveStockOrThrow('bank-1', 'A+', 500, { requestId: 'req-1', urgency: 'CRITICAL' });
      expect(auditRepo.save).toHaveBeenCalled();
    });
  });

  describe('concurrent reservation simulation', () => {
    it('only one of N concurrent requests succeeds when stock is exactly enough for one', async () => {
      // Simulate 5 concurrent workers: first wins, rest get version conflict
      let callCount = 0;
      stockRepo.atomicDecrement.mockImplementation(() => {
        callCount++;
        // Only the very first call succeeds; all others fail (version conflict)
        return Promise.resolve({ affected: callCount === 1 ? 1 : 0 });
      });

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          service.reserveStockOrThrow('bank-1', 'A+', 500),
        ),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      // Exactly one succeeds; the rest fail with ConflictException
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(4);
    });
  });

  describe('releaseExpiredReservations — expiration auto-release', () => {
    it('marks expired reservations as EXPIRED and restores stock', async () => {
      const expiredRes = {
        id: 'res-1', requestId: 'req-1', bloodBankId: 'bank-1',
        bloodUnitId: 'A+', quantityMl: 300,
        status: ReservationStatus.RESERVED,
        expiresAt: Math.floor(Date.now() / 1000) - 60,
      };
      reservationRepo.find.mockResolvedValue([expiredRes]);
      await service.releaseExpiredReservations();
      expect(reservationRepo.createQueryBuilder().execute).toHaveBeenCalled();
      expect(stockRepo.atomicIncrement).toHaveBeenCalled();
      expect(auditRepo.save).toHaveBeenCalled();
    });

    it('skips reservations already handled by another worker (affected=0)', async () => {
      const expiredRes = {
        id: 'res-2', requestId: 'req-2', bloodBankId: 'bank-1',
        bloodUnitId: 'A+', quantityMl: 300,
        status: ReservationStatus.RESERVED,
        expiresAt: Math.floor(Date.now() / 1000) - 60,
      };
      reservationRepo.find.mockResolvedValue([expiredRes]);
      reservationRepo.createQueryBuilder().execute.mockResolvedValue({ affected: 0 });
      await service.releaseExpiredReservations();
      expect(stockRepo.atomicIncrement).not.toHaveBeenCalled();
    });
  });
});
