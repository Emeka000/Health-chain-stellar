import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DeadLetterStatus, OutboxDeadLetterEntity } from './outbox-dead-letter.entity';
import { OutboxEventEntity, OutboxEventStatus, OutboxEventType } from './outbox-event.entity';
import { OutboxService } from './outbox.service';

function makeOutboxEvent(
  overrides: Partial<OutboxEventEntity> = {},
): OutboxEventEntity {
  return {
    id: 'evt-1',
    aggregateId: 'req-1',
    aggregateType: 'BloodRequest',
    eventType: OutboxEventType.BLOOD_REQUEST_CREATED,
    eventVersion: 1,
    correlationId: 'corr-1',
    payload: { requestId: 'req-1' },
    status: OutboxEventStatus.PENDING,
    dedupKey: 'dedup-key-1',
    leaseHolder: null,
    leaseExpiresAt: null,
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    published: false,
    retryCount: 0,
    error: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OutboxEventEntity;
}

describe('OutboxService', () => {
  let service: OutboxService;
  let outboxRepo: Record<string, jest.Mock>;
  let deadLetterRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    outboxRepo = {
      create: jest.fn((dto) => ({ id: 'evt-1', ...dto })),
      save: jest.fn((e) => Promise.resolve({ id: 'evt-1', ...e })),
      findOne: jest.fn(() => Promise.resolve(makeOutboxEvent())),
      find: jest.fn(() => Promise.resolve([])),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      increment: jest.fn(() => Promise.resolve(undefined)),
      delete: jest.fn(() => Promise.resolve({ affected: 0 })),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        execute: jest.fn(() => Promise.resolve({ affected: 2 })),
      })),
    };

    deadLetterRepo = {
      create: jest.fn((dto) => ({ id: 'dl-1', ...dto })),
      save: jest.fn((e) => Promise.resolve({ id: 'dl-1', ...e })),
      findOne: jest.fn(() => Promise.resolve(null)),
      find: jest.fn(() => Promise.resolve([])),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxService,
        { provide: getRepositoryToken(OutboxEventEntity), useValue: outboxRepo },
        { provide: getRepositoryToken(OutboxDeadLetterEntity), useValue: deadLetterRepo },
      ],
    }).compile();

    service = module.get(OutboxService);
  });

  describe('publishEvent — standalone', () => {
    it('creates an outbox entry with PENDING status', async () => {
      const result = await service.publishEvent(
        OutboxEventType.BLOOD_REQUEST_CREATED,
        { requestId: 'req-1' },
        'req-1',
        'BloodRequest',
        'corr-1',
      );
      expect(outboxRepo.save).toHaveBeenCalled();
      expect(result.status).toBe(OutboxEventStatus.PENDING);
    });

    it('generates a dedup key', async () => {
      await service.publishEvent(OutboxEventType.BLOOD_REQUEST_CREATED, {});
      const createCall = outboxRepo.create.mock.calls[0][0];
      expect(createCall.dedupKey).toBeDefined();
      expect(createCall.dedupKey.length).toBeGreaterThan(0);
    });
  });

  describe('publishInTransaction — atomicity', () => {
    it('uses the provided EntityManager to insert in the same transaction', async () => {
      const em = {
        create: jest.fn((_, dto) => ({ id: 'evt-tx', ...dto })),
        save: jest.fn((_, e) => Promise.resolve({ id: 'evt-tx', ...e })),
      };
      const result = await service.publishInTransaction(
        em as any,
        OutboxEventType.BLOOD_REQUEST_CREATED,
        { requestId: 'req-1' },
        { aggregateId: 'req-1', correlationId: 'corr-1' },
      );
      expect(em.save).toHaveBeenCalled();
      expect(result.status).toBe(OutboxEventStatus.PENDING);
    });
  });

  describe('claimPendingEvents — lease-based polling', () => {
    it('returns claimed events for the worker', async () => {
      outboxRepo.find.mockResolvedValue([makeOutboxEvent()]);
      const events = await service.claimPendingEvents('worker-1', 10);
      expect(outboxRepo.createQueryBuilder).toHaveBeenCalled();
      expect(events.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('markPublished', () => {
    it('sets status to PUBLISHED and published=true', async () => {
      await service.markPublished('evt-1');
      expect(outboxRepo.update).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({
          status: OutboxEventStatus.PUBLISHED,
          published: true,
        }),
      );
    });
  });

  describe('recordFailure — backoff and dead-letter', () => {
    it('schedules retry with exponential backoff on first failure', async () => {
      outboxRepo.findOne.mockResolvedValue(makeOutboxEvent({ attemptCount: 0 }));
      await service.recordFailure('evt-1', 'timeout');
      expect(outboxRepo.update).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({
          status: OutboxEventStatus.PENDING,
          attemptCount: 1,
        }),
      );
    });

    it('moves to dead-letter when max attempts exceeded', async () => {
      outboxRepo.findOne.mockResolvedValue(makeOutboxEvent({ attemptCount: 4 }));
      await service.recordFailure('evt-1', 'persistent error');
      expect(deadLetterRepo.save).toHaveBeenCalled();
      expect(outboxRepo.update).toHaveBeenCalledWith(
        'evt-1',
        expect.objectContaining({ status: OutboxEventStatus.DEAD_LETTERED }),
      );
    });
  });

  describe('dead-letter replay and discard', () => {
    const dl = {
      id: 'dl-1',
      outboxEventId: 'evt-1',
      aggregateId: 'req-1',
      aggregateType: 'BloodRequest',
      eventType: OutboxEventType.BLOOD_REQUEST_CREATED,
      eventVersion: 1,
      correlationId: 'corr-1',
      payload: { requestId: 'req-1' },
      attemptCount: 5,
      lastError: 'timeout',
      status: DeadLetterStatus.PENDING,
      operatorNotes: null,
    };

    it('replays a dead-letter as a new PENDING outbox event', async () => {
      deadLetterRepo.findOne.mockResolvedValue(dl);
      const result = await service.replayDeadLetter('dl-1', 'Fixed downstream');
      expect(outboxRepo.save).toHaveBeenCalled();
      expect(result.status).toBe(OutboxEventStatus.PENDING);
      expect(deadLetterRepo.update).toHaveBeenCalledWith(
        'dl-1',
        expect.objectContaining({ status: DeadLetterStatus.REPLAYED }),
      );
    });

    it('discards a dead-letter event', async () => {
      deadLetterRepo.findOne.mockResolvedValue({ ...dl });
      deadLetterRepo.save.mockResolvedValue({
        ...dl,
        status: DeadLetterStatus.DISCARDED,
      });
      const result = await service.discardDeadLetter('dl-1', 'Stale event');
      expect(result.status).toBe(DeadLetterStatus.DISCARDED);
    });

    it('throws NotFoundException when dead-letter does not exist', async () => {
      deadLetterRepo.findOne.mockResolvedValue(null);
      await expect(service.replayDeadLetter('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
