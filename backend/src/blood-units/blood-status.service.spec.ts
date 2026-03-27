import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { Repository } from 'typeorm';

import { NotificationsService } from '../notifications/notifications.service';
import { BlockchainEvent } from '../soroban/entities/blockchain-event.entity';

import {
  ALLOWED_TRANSITIONS,
  BloodStatusService,
} from './blood-status.service';
import { BloodStatusHistory } from './entities/blood-status-history.entity';
import { BloodUnit } from './entities/blood-unit.entity';
import { BloodStatus } from './enums/blood-status.enum';

const makeUnit = (overrides: Partial<BloodUnit> = {}): BloodUnit =>
  ({
    id: 'unit-uuid-1',
    unitCode: 'TEST-001',
    bloodType: 'A+' as any,
    status: BloodStatus.AVAILABLE,
    organizationId: 'org-1',
    reservedFor: null,
    reservedUntil: null,
    ...overrides,
  }) as BloodUnit;

describe('BloodStatusService', () => {
  let service: BloodStatusService;

  let bloodUnitRepository: jest.Mocked<Partial<Repository<BloodUnit>>>;
  let statusHistoryRepository: jest.Mocked<
    Partial<Repository<BloodStatusHistory>>
  >;
  let blockchainEventRepository: jest.Mocked<
    Partial<Repository<BlockchainEvent>>
  >;
  let notificationsService: jest.Mocked<Partial<NotificationsService>>;

  beforeEach(() => {
    bloodUnitRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
    };

    statusHistoryRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    };

    blockchainEventRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };

    notificationsService = {
      send: jest.fn(),
    };

    service = new BloodStatusService(
      bloodUnitRepository as Repository<BloodUnit>,
      statusHistoryRepository as Repository<BloodStatusHistory>,
      blockchainEventRepository as Repository<BlockchainEvent>,
      notificationsService as NotificationsService,
    );
  });

  // ── State machine ────────────────────────────────────────────────────

  describe('isValidTransition', () => {
    it('allows AVAILABLE → RESERVED', () => {
      expect(
        service.isValidTransition(BloodStatus.AVAILABLE, BloodStatus.RESERVED),
      ).toBe(true);
    });

    it('allows RESERVED → IN_TRANSIT', () => {
      expect(
        service.isValidTransition(BloodStatus.RESERVED, BloodStatus.IN_TRANSIT),
      ).toBe(true);
    });

    it('allows RESERVED → AVAILABLE (release)', () => {
      expect(
        service.isValidTransition(BloodStatus.RESERVED, BloodStatus.AVAILABLE),
      ).toBe(true);
    });

    it('allows IN_TRANSIT → DELIVERED', () => {
      expect(
        service.isValidTransition(
          BloodStatus.IN_TRANSIT,
          BloodStatus.DELIVERED,
        ),
      ).toBe(true);
    });

    it('allows QUARANTINED → AVAILABLE', () => {
      expect(
        service.isValidTransition(
          BloodStatus.QUARANTINED,
          BloodStatus.AVAILABLE,
        ),
      ).toBe(true);
    });

    it('allows EXPIRED → DISCARDED', () => {
      expect(
        service.isValidTransition(BloodStatus.EXPIRED, BloodStatus.DISCARDED),
      ).toBe(true);
    });

    it('rejects DELIVERED → AVAILABLE (terminal state)', () => {
      expect(
        service.isValidTransition(BloodStatus.DELIVERED, BloodStatus.AVAILABLE),
      ).toBe(false);
    });

    it('rejects DISCARDED → AVAILABLE (terminal state)', () => {
      expect(
        service.isValidTransition(BloodStatus.DISCARDED, BloodStatus.AVAILABLE),
      ).toBe(false);
    });

    it('rejects IN_TRANSIT → AVAILABLE (skipping steps)', () => {
      expect(
        service.isValidTransition(
          BloodStatus.IN_TRANSIT,
          BloodStatus.AVAILABLE,
        ),
      ).toBe(false);
    });

    it('covers all statuses in the transition map', () => {
      const statuses = Object.values(BloodStatus);
      statuses.forEach((s) => {
        expect(ALLOWED_TRANSITIONS).toHaveProperty(s);
      });
    });
  });

  // ── updateStatus ─────────────────────────────────────────────────────

  describe('updateStatus', () => {
    it('transitions status and creates a history record', async () => {
      const unit = makeUnit();
      const historyEntry = { id: 'hist-1' } as BloodStatusHistory;

      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(unit);
      (bloodUnitRepository.save as jest.Mock).mockResolvedValue(unit);
      (statusHistoryRepository.create as jest.Mock).mockReturnValue(
        historyEntry,
      );
      (statusHistoryRepository.save as jest.Mock).mockResolvedValue(
        historyEntry,
      );
      (blockchainEventRepository.create as jest.Mock).mockReturnValue({});
      (blockchainEventRepository.save as jest.Mock).mockResolvedValue({});
      (notificationsService.send as jest.Mock).mockResolvedValue([]);

      const result = await service.updateStatus(
        'unit-uuid-1',
        { status: BloodStatus.QUARANTINED, reason: 'Failed QC' },
        { id: 'user-1', role: 'admin' },
      );

      expect(result.success).toBe(true);
      expect(result.previousStatus).toBe(BloodStatus.AVAILABLE);
      expect(result.newStatus).toBe(BloodStatus.QUARANTINED);
      expect(result.historyId).toBe('hist-1');
      expect(bloodUnitRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: BloodStatus.QUARANTINED }),
      );
      expect(statusHistoryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          previousStatus: BloodStatus.AVAILABLE,
          newStatus: BloodStatus.QUARANTINED,
          reason: 'Failed QC',
          changedBy: 'user-1',
        }),
      );
    });

    it('throws NotFoundException when unit does not exist', async () => {
      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateStatus('missing-id', { status: BloodStatus.EXPIRED }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for invalid transition', async () => {
      const unit = makeUnit({ status: BloodStatus.DELIVERED });
      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(unit);

      await expect(
        service.updateStatus('unit-uuid-1', { status: BloodStatus.AVAILABLE }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when status is unchanged', async () => {
      const unit = makeUnit({ status: BloodStatus.AVAILABLE });
      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(unit);

      await expect(
        service.updateStatus('unit-uuid-1', { status: BloodStatus.AVAILABLE }),
      ).rejects.toThrow(BadRequestException);
    });

    it('clears reservation fields when leaving RESERVED status', async () => {
      const unit = makeUnit({
        status: BloodStatus.RESERVED,
        reservedFor: 'hospital-1',
        reservedUntil: new Date(Date.now() + 3_600_000),
      });
      const historyEntry = { id: 'hist-2' } as BloodStatusHistory;

      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(unit);
      (bloodUnitRepository.save as jest.Mock).mockResolvedValue(unit);
      (statusHistoryRepository.create as jest.Mock).mockReturnValue(
        historyEntry,
      );
      (statusHistoryRepository.save as jest.Mock).mockResolvedValue(
        historyEntry,
      );
      (blockchainEventRepository.create as jest.Mock).mockReturnValue({});
      (blockchainEventRepository.save as jest.Mock).mockResolvedValue({});
      (notificationsService.send as jest.Mock).mockResolvedValue([]);

      await service.updateStatus('unit-uuid-1', {
        status: BloodStatus.IN_TRANSIT,
      });

      expect(bloodUnitRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ reservedFor: null, reservedUntil: null }),
      );
    });

    it('syncs to blockchain and continues even when blockchain sync fails', async () => {
      const unit = makeUnit();
      const historyEntry = { id: 'hist-3' } as BloodStatusHistory;

      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(unit);
      (bloodUnitRepository.save as jest.Mock).mockResolvedValue(unit);
      (statusHistoryRepository.create as jest.Mock).mockReturnValue(
        historyEntry,
      );
      (statusHistoryRepository.save as jest.Mock).mockResolvedValue(
        historyEntry,
      );
      (blockchainEventRepository.create as jest.Mock).mockReturnValue({});
      (blockchainEventRepository.save as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );
      (notificationsService.send as jest.Mock).mockResolvedValue([]);

      const result = await service.updateStatus('unit-uuid-1', {
        status: BloodStatus.PROCESSING,
      });

      expect(result.success).toBe(true);
    });

    it('continues even when notification fails', async () => {
      const unit = makeUnit();
      const historyEntry = { id: 'hist-4' } as BloodStatusHistory;

      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(unit);
      (bloodUnitRepository.save as jest.Mock).mockResolvedValue(unit);
      (statusHistoryRepository.create as jest.Mock).mockReturnValue(
        historyEntry,
      );
      (statusHistoryRepository.save as jest.Mock).mockResolvedValue(
        historyEntry,
      );
      (blockchainEventRepository.create as jest.Mock).mockReturnValue({});
      (blockchainEventRepository.save as jest.Mock).mockResolvedValue({});
      (notificationsService.send as jest.Mock).mockRejectedValue(
        new Error('SMTP down'),
      );

      const result = await service.updateStatus('unit-uuid-1', {
        status: BloodStatus.EXPIRED,
      });

      expect(result.success).toBe(true);
    });
  });

  // ── bulkUpdateStatus ──────────────────────────────────────────────────

  describe('bulkUpdateStatus', () => {
    it('updates multiple units successfully', async () => {
      const updateSpy = jest.spyOn(service, 'updateStatus').mockResolvedValue({
        success: true,
        unitId: 'unit-uuid-1',
        previousStatus: BloodStatus.AVAILABLE,
        newStatus: BloodStatus.QUARANTINED,
        historyId: 'hist-1',
      });

      const result = await service.bulkUpdateStatus({
        unitIds: ['unit-uuid-1', 'unit-uuid-2'],
        status: BloodStatus.QUARANTINED,
        reason: 'Batch quarantine',
      });

      expect(updateSpy).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(2);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.success).toBe(true);
    });

    it('reports partial failures without throwing', async () => {
      jest
        .spyOn(service, 'updateStatus')
        .mockResolvedValueOnce({
          success: true,
          unitId: 'unit-uuid-1',
          previousStatus: BloodStatus.AVAILABLE,
          newStatus: BloodStatus.EXPIRED,
          historyId: 'hist-1',
        })
        .mockRejectedValueOnce(
          new NotFoundException('Blood unit unit-uuid-2 not found'),
        );

      const result = await service.bulkUpdateStatus({
        unitIds: ['unit-uuid-1', 'unit-uuid-2'],
        status: BloodStatus.EXPIRED,
      });

      expect(result.total).toBe(2);
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.success).toBe(false);
      expect(result.errors[0].message).toContain('not found');
    });
  });

  // ── reserveUnit ───────────────────────────────────────────────────────

  describe('reserveUnit', () => {
    it('reserves an available unit', async () => {
      const unit = makeUnit();
      const reservedUntil = new Date(Date.now() + 3_600_000).toISOString();
      const historyEntry = { id: 'hist-res-1' } as BloodStatusHistory;

      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(unit);
      (bloodUnitRepository.save as jest.Mock).mockResolvedValue(unit);
      (statusHistoryRepository.create as jest.Mock).mockReturnValue(
        historyEntry,
      );
      (statusHistoryRepository.save as jest.Mock).mockResolvedValue(
        historyEntry,
      );
      (blockchainEventRepository.create as jest.Mock).mockReturnValue({});
      (blockchainEventRepository.save as jest.Mock).mockResolvedValue({});

      const result = await service.reserveUnit(
        'unit-uuid-1',
        { reservedFor: 'hospital-99', reservedUntil, reason: 'Emergency' },
        { id: 'user-1', role: 'hospital' },
      );

      expect(result.success).toBe(true);
      expect(result.reservedFor).toBe('hospital-99');
      expect(bloodUnitRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: BloodStatus.RESERVED,
          reservedFor: 'hospital-99',
        }),
      );
    });

    it('throws ConflictException when unit is not AVAILABLE', async () => {
      const unit = makeUnit({ status: BloodStatus.IN_TRANSIT });
      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(unit);

      await expect(
        service.reserveUnit('unit-uuid-1', {
          reservedFor: 'hospital-1',
          reservedUntil: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws NotFoundException when unit does not exist', async () => {
      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.reserveUnit('missing-id', {
          reservedFor: 'hospital-1',
          reservedUntil: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getStatusHistory ──────────────────────────────────────────────────

  describe('getStatusHistory', () => {
    it('returns status history for a valid unit', async () => {
      const history = [
        { id: 'h1', newStatus: BloodStatus.RESERVED } as BloodStatusHistory,
        { id: 'h2', newStatus: BloodStatus.AVAILABLE } as BloodStatusHistory,
      ];

      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'unit-uuid-1',
      });
      (statusHistoryRepository.find as jest.Mock).mockResolvedValue(history);

      const result = await service.getStatusHistory('unit-uuid-1');

      expect(result.unitId).toBe('unit-uuid-1');
      expect(result.history).toHaveLength(2);
      expect(statusHistoryRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { bloodUnitId: 'unit-uuid-1' } }),
      );
    });

    it('throws NotFoundException for unknown unit', async () => {
      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getStatusHistory('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── releaseExpiredReservations ────────────────────────────────────────

  describe('releaseExpiredReservations', () => {
    it('releases expired reservations back to AVAILABLE', async () => {
      const expiredUnit = makeUnit({
        status: BloodStatus.RESERVED,
        reservedFor: 'hospital-5',
        reservedUntil: new Date(Date.now() - 1000),
      });

      (bloodUnitRepository.find as jest.Mock).mockResolvedValue([expiredUnit]);
      (bloodUnitRepository.save as jest.Mock).mockResolvedValue(expiredUnit);
      (statusHistoryRepository.create as jest.Mock).mockReturnValue({});
      (statusHistoryRepository.save as jest.Mock).mockResolvedValue({});
      (blockchainEventRepository.create as jest.Mock).mockReturnValue({});
      (blockchainEventRepository.save as jest.Mock).mockResolvedValue({});

      await service.releaseExpiredReservations();

      expect(bloodUnitRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: BloodStatus.AVAILABLE,
          reservedFor: null,
          reservedUntil: null,
        }),
      );
      expect(statusHistoryRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          previousStatus: BloodStatus.RESERVED,
          newStatus: BloodStatus.AVAILABLE,
        }),
      );
    });

    it('does nothing when no expired reservations exist', async () => {
      (bloodUnitRepository.find as jest.Mock).mockResolvedValue([]);

      await service.releaseExpiredReservations();

      expect(bloodUnitRepository.save).not.toHaveBeenCalled();
    });

    it('continues processing remaining units when one fails', async () => {
      const unit1 = makeUnit({
        id: 'unit-1',
        status: BloodStatus.RESERVED,
        reservedUntil: new Date(Date.now() - 1000),
      });
      const unit2 = makeUnit({
        id: 'unit-2',
        status: BloodStatus.RESERVED,
        reservedUntil: new Date(Date.now() - 1000),
      });

      (bloodUnitRepository.find as jest.Mock).mockResolvedValue([unit1, unit2]);
      (bloodUnitRepository.save as jest.Mock)
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce(unit2);
      (statusHistoryRepository.create as jest.Mock).mockReturnValue({});
      (statusHistoryRepository.save as jest.Mock).mockResolvedValue({});
      (blockchainEventRepository.create as jest.Mock).mockReturnValue({});
      (blockchainEventRepository.save as jest.Mock).mockResolvedValue({});

      await expect(service.releaseExpiredReservations()).resolves.not.toThrow();
      expect(bloodUnitRepository.save).toHaveBeenCalledTimes(2);
    });
  });
});
