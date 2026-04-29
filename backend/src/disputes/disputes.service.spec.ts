import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DisputesService } from './disputes.service';
import { DisputeEntity } from './entities/dispute.entity';
import { DisputeNoteEntity } from './entities/dispute-note.entity';
import { ReconciliationLogEntity } from '../soroban/entities/reconciliation-log.entity';
import { SorobanService } from '../soroban/soroban.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DisputeStatus } from './enums/dispute.enum';

describe('DisputesService timeout scanner', () => {
  let service: DisputesService;

  const disputeRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const noteRepo = {};
  const reconRepo = {
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => x),
  };
  const sorobanService = { getDisputeState: jest.fn() };
  const notificationsService = { send: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisputesService,
        { provide: getRepositoryToken(DisputeEntity), useValue: disputeRepo },
        { provide: getRepositoryToken(DisputeNoteEntity), useValue: noteRepo },
        { provide: getRepositoryToken(ReconciliationLogEntity), useValue: reconRepo },
        { provide: SorobanService, useValue: sorobanService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();
    service = module.get(DisputesService);
  });

  it('processes boundary timestamp (deadline exactly now)', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    disputeRepo.find.mockResolvedValue([
      {
        id: 'd-1',
        status: DisputeStatus.OPEN,
        timeoutDeadlineAt: now,
        timeoutProcessedAt: null,
      },
    ]);
    disputeRepo.findOne.mockResolvedValue({
      id: 'd-1',
      status: DisputeStatus.OPEN,
      timeoutDeadlineAt: now,
      timeoutProcessedAt: null,
      openedBy: 'u-1',
      assignedTo: null,
      contractDisputeId: null,
      orderId: null,
    });
    disputeRepo.update.mockResolvedValue({ affected: 1 });
    sorobanService.getDisputeState.mockResolvedValue(null);

    const processed = await service.scanAndProcessExpiredDisputes(now);
    expect(processed).toBe(1);
    expect(disputeRepo.update).toHaveBeenCalled();
  });

  it('does not duplicate resolutions on repeated scans', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    disputeRepo.find.mockResolvedValue([
      {
        id: 'd-2',
        status: DisputeStatus.OPEN,
        timeoutDeadlineAt: now,
        timeoutProcessedAt: null,
      },
    ]);
    disputeRepo.findOne.mockResolvedValue({
      id: 'd-2',
      status: DisputeStatus.OPEN,
      timeoutDeadlineAt: now,
      timeoutProcessedAt: null,
      openedBy: 'u-2',
      assignedTo: null,
      contractDisputeId: null,
      orderId: null,
    });
    disputeRepo.update.mockResolvedValueOnce({ affected: 1 }).mockResolvedValueOnce({ affected: 0 });
    sorobanService.getDisputeState.mockResolvedValue(null);

    const first = await service.scanAndProcessExpiredDisputes(now);
    const second = await service.scanAndProcessExpiredDisputes(now);
    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('handles race when manual resolution occurs first', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    disputeRepo.find.mockResolvedValue([
      {
        id: 'd-3',
        status: DisputeStatus.OPEN,
        timeoutDeadlineAt: now,
        timeoutProcessedAt: null,
      },
    ]);
    disputeRepo.findOne.mockResolvedValue({
      id: 'd-3',
      status: DisputeStatus.OPEN,
      timeoutDeadlineAt: now,
      timeoutProcessedAt: null,
      openedBy: 'u-3',
      assignedTo: null,
      contractDisputeId: null,
      orderId: null,
    });
    // Update affected=0 means scanner lost race to manual resolve.
    disputeRepo.update.mockResolvedValue({ affected: 0 });
    sorobanService.getDisputeState.mockResolvedValue(null);

    const processed = await service.scanAndProcessExpiredDisputes(now);
    expect(processed).toBe(0);
    expect(reconRepo.save).not.toHaveBeenCalled();
  });
});
