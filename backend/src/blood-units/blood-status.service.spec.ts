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
        new Error('soroban down'),
      );
      (notificationsService.send as jest.Mock).mockResolvedValue([]);

      const result = await service.updateStatus('unit-uuid-1', {
        status: BloodStatus.QUARANTINED,
      });

      expect(result.success).toBe(true);
      expect(result.blockchainSynced).toBe(false);
    });
  });

  // ── assertOwnsUnit ───────────────────────────────────────────────────

  describe('assertOwnsUnit', () => {
    it('resolves when the unit belongs to the organization', async () => {
      const unit = makeUnit({ organizationId: 'org-1' });
      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(unit);

      await expect(
        service.assertOwnsUnit('unit-uuid-1', 'org-1'),
      ).resolves.toBeUndefined();
    });

    it('throws NotFoundException when the unit does not exist', async () => {
      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.assertOwnsUnit('missing-id', 'org-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the unit belongs to another organization', async () => {
      const unit = makeUnit({ organizationId: 'org-2' });
      (bloodUnitRepository.findOne as jest.Mock).mockResolvedValue(unit);

      await expect(
        service.assertOwnsUnit('unit-uuid-1', 'org-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ── validateTransition ───────────────────────────────────────────────

  describe('validateTransition', () => {
    it('does not throw for a valid transition', () => {
      expect(() =>
        service.validateTransition(BloodStatus.AVAILABLE, BloodStatus.RESERVED),
      ).not.toThrow();
    });

    it('throws BadRequestException for an invalid transition', () => {
      expect(() =>
        service.validateTransition(BloodStatus.DELIVERED, BloodStatus.AVAILABLE),
      ).toThrow(BadRequestException);
    });
  });
});
