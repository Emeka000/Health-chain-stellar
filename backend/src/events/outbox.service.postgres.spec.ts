import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OutboxService } from './outbox.service';
import { OutboxEventEntity, OutboxEventStatus } from './outbox-event.entity';
import { OutboxDeadLetterEntity } from './outbox-dead-letter.entity';

describe('OutboxService - PostgreSQL Query (Issue 1686)', () => {
  let service: OutboxService;
  let outboxRepo: Repository<OutboxEventEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OutboxService,
        {
          provide: getRepositoryToken(OutboxEventEntity),
          useValue: {
            query: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
            increment: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(OutboxDeadLetterEntity),
          useValue: {
            save: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<OutboxService>(OutboxService);
    outboxRepo = module.get<Repository<OutboxEventEntity>>(getRepositoryToken(OutboxEventEntity));
  });

  describe('claimPendingEvents', () => {
    it('should use PostgreSQL-compatible subquery with FOR UPDATE SKIP LOCKED', async () => {
      const mockEvent = {
        id: 'event-1',
        aggregate_id: 'agg-1',
        aggregate_type: 'ORDER',
        event_type: 'ORDER_CREATED',
        event_version: 1,
        correlation_id: 'corr-1',
        payload: { test: 'data' },
        status: OutboxEventStatus.PROCESSING,
        dedup_key: 'dedup-1',
        lease_holder: 'worker-1',
        lease_expires_at: new Date(),
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
        published: false,
        retry_count: 0,
        error: null,
        published_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      jest.spyOn(outboxRepo, 'query').mockResolvedValue([mockEvent]);
      jest.spyOn(outboxRepo, 'create').mockReturnValue(mockEvent as any);

      const result = await service.claimPendingEvents('worker-1', 50);

      // Verify raw query was called (indicating PostgreSQL compatibility)
      expect(outboxRepo.query).toHaveBeenCalled();
      const queryCall = (outboxRepo.query as jest.Mock).mock.calls[0];

      // Check that the query uses FOR UPDATE SKIP LOCKED
      expect(queryCall[0]).toContain('FOR UPDATE SKIP LOCKED');

      // Check that LIMIT is inside the subquery (PostgreSQL syntax)
      expect(queryCall[0]).toContain('LIMIT $7');

      // Check that the query uses a subquery approach
      expect(queryCall[0]).toContain('WHERE id IN (');
      expect(queryCall[0]).toContain('SELECT id FROM outbox_events');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should map database rows to OutboxEventEntity objects', async () => {
      const now = new Date();
      const mockDbRow = {
        id: 'event-1',
        aggregate_id: 'agg-1',
        aggregate_type: 'ORDER',
        event_type: 'ORDER_CREATED',
        event_version: 1,
        correlation_id: 'corr-1',
        payload: { test: 'data' },
        status: OutboxEventStatus.PROCESSING,
        dedup_key: 'dedup-1',
        lease_holder: 'worker-1',
        lease_expires_at: now,
        attempt_count: 0,
        next_attempt_at: null,
        last_error: null,
        published: false,
        retry_count: 0,
        error: null,
        published_at: null,
        created_at: now,
        updated_at: now,
      };

      jest.spyOn(outboxRepo, 'query').mockResolvedValue([mockDbRow]);

      const createSpy = jest.spyOn(outboxRepo, 'create').mockReturnValue({
        id: 'event-1',
        aggregateId: 'agg-1',
        aggregateType: 'ORDER',
        eventType: 'ORDER_CREATED',
      } as any);

      await service.claimPendingEvents('worker-1', 50);

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'event-1',
          aggregateId: 'agg-1',
          aggregateType: 'ORDER',
          eventType: 'ORDER_CREATED',
          status: OutboxEventStatus.PROCESSING,
        }),
      );
    });

    it('should return empty array when no events are claimed', async () => {
      jest.spyOn(outboxRepo, 'query').mockResolvedValue([]);

      const result = await service.claimPendingEvents('worker-1', 50);

      expect(result).toEqual([]);
    });

    it('should pass correct parameters to the query', async () => {
      const workerId = 'worker-1';
      const limit = 25;

      jest.spyOn(outboxRepo, 'query').mockResolvedValue([]);

      await service.claimPendingEvents(workerId, limit);

      const queryCall = (outboxRepo.query as jest.Mock).mock.calls[0];
      const params = queryCall[1];

      // Verify parameters are passed correctly
      expect(params.length).toBe(7); // workerId, leaseExpiry, PENDING status, now, now, MAX_ATTEMPTS, limit
      expect(params[1]).toEqual(workerId); // lease_holder
      expect(params[3]).toEqual(OutboxEventStatus.PENDING); // status filter
      expect(params[6]).toEqual(limit); // limit parameter
    });
  });
});
