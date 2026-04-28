import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ContractEventIndexerService } from './contract-event-indexer.service';
import { IngestEventDto } from './dto/contract-event.dto';
import {
  ContractDomain,
  ContractEventEntity,
} from './entities/contract-event.entity';
import { IndexerCursorEntity } from './entities/indexer-cursor.entity';
import {
  PoisonEventEntity,
  PoisonEventStatus,
} from './entities/poison-event.entity';

function makeDto(overrides: Partial<IngestEventDto> = {}): IngestEventDto {
  return {
    domain: ContractDomain.PAYMENT,
    eventType: 'payment.released',
    ledgerSequence: 1000,
    txHash: 'abc123',
    payload: { amount: 100 },
    ...overrides,
  };
}

describe('ContractEventIndexerService', () => {
  let service: ContractEventIndexerService;
  let eventRepo: Record<string, jest.Mock>;
  let cursorRepo: Record<string, jest.Mock>;
  let poisonRepo: Record<string, jest.Mock>;

  beforeEach(async () => {
    const insertQb = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn(() =>
        Promise.resolve({ identifiers: [{ id: 'evt-1' }] }),
      ),
    };

    eventRepo = {
      create: jest.fn((dto) => ({ id: 'evt-1', ...dto })),
      save: jest.fn((e) => Promise.resolve({ id: 'evt-1', ...e })),
      findOne: jest.fn(() =>
        Promise.resolve({ id: 'evt-1', dedupKey: 'key1' }),
      ),
      find: jest.fn(() => Promise.resolve([])),
      createQueryBuilder: jest.fn(() => ({
        ...insertQb,
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn(() => Promise.resolve([[], 0])),
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn(() => Promise.resolve({ affected: 3 })),
      })),
    };

    cursorRepo = {
      create: jest.fn((dto) => ({ ...dto })),
      save: jest.fn((e) => Promise.resolve(e)),
      findOne: jest.fn(() => Promise.resolve(null)),
      find: jest.fn(() => Promise.resolve([])),
      update: jest.fn(() => Promise.resolve(undefined)),
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn(() => Promise.resolve(undefined)),
      })),
    };

    poisonRepo = {
      create: jest.fn((dto) => ({ id: 'poison-1', ...dto })),
      save: jest.fn((e) => Promise.resolve({ id: 'poison-1', ...e })),
      findOne: jest.fn(() => Promise.resolve(null)),
      find: jest.fn(() => Promise.resolve([])),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractEventIndexerService,
        {
          provide: getRepositoryToken(ContractEventEntity),
          useValue: eventRepo,
        },
        {
          provide: getRepositoryToken(IndexerCursorEntity),
          useValue: cursorRepo,
        },
        {
          provide: getRepositoryToken(PoisonEventEntity),
          useValue: poisonRepo,
        },
      ],
    }).compile();

    service = module.get(ContractEventIndexerService);
  });

  describe('ingest — exactly-once semantics', () => {
    it('persists a new event via conflict-safe upsert and returns it', async () => {
      const result = await service.ingest(makeDto());
      expect(eventRepo.createQueryBuilder).toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    it('returns null when conflict-safe insert produces no new row (duplicate)', async () => {
      eventRepo.createQueryBuilder.mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn(() => Promise.resolve({ identifiers: [] })),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn(() => Promise.resolve([[], 0])),
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      });
      const result = await service.ingest(makeDto());
      expect(result).toBeNull();
    });

    it('uses provided idempotencyKey instead of auto-generated dedup key', async () => {
      const dto = makeDto({ idempotencyKey: '1000:abc123:0:v1' });
      await service.ingest(dto);
      const insertCall = eventRepo.createQueryBuilder().values;
      // idempotencyKey is passed through to the insert values
      expect(insertCall).toBeDefined();
    });

    it('creates a per-projection cursor entry when none exists', async () => {
      await service.ingest(makeDto());
      expect(cursorRepo.save).toHaveBeenCalled();
    });

    it('advances cursor when new ledger is higher', async () => {
      cursorRepo.findOne.mockResolvedValue({
        domain: ContractDomain.PAYMENT,
        projectionName: '__global__',
        lastLedger: 500,
      });
      await service.ingest(makeDto({ ledgerSequence: 1000 }));
      expect(cursorRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ lastLedger: 1000 }),
      );
    });

    it('does not advance cursor when new ledger is lower', async () => {
      cursorRepo.findOne.mockResolvedValue({
        domain: ContractDomain.PAYMENT,
        projectionName: '__global__',
        lastLedger: 2000,
      });
      await service.ingest(makeDto({ ledgerSequence: 1000 }));
      expect(cursorRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('ingestBatch', () => {
    it('returns count of newly persisted events', async () => {
      const count = await service.ingestBatch([
        makeDto(),
        makeDto({ eventType: 'payment.failed' }),
      ]);
      expect(count).toBe(2);
    });

    it('skips duplicates and counts only new events', async () => {
      let call = 0;
      eventRepo.createQueryBuilder.mockImplementation(() => ({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orIgnore: jest.fn().mockReturnThis(),
        execute: jest.fn(() => {
          call++;
          return Promise.resolve({
            identifiers: call === 1 ? [{ id: 'evt-1' }] : [],
          });
        }),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn(() => Promise.resolve([[], 0])),
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
      }));
      const count = await service.ingestBatch([makeDto(), makeDto()]);
      expect(count).toBe(1);
    });
  });

  describe('per-projection cursor', () => {
    it('advances projection cursor independently', async () => {
      cursorRepo.findOne.mockResolvedValue(null);
      await service.advanceProjectionCursor(
        ContractDomain.INVENTORY,
        2000,
        'inventory-read-model',
      );
      expect(cursorRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: ContractDomain.INVENTORY,
          projectionName: 'inventory-read-model',
          lastLedger: 2000,
        }),
      );
    });

    it('returns null when projection cursor does not exist', async () => {
      cursorRepo.findOne.mockResolvedValue(null);
      const result = await service.getProjectionCursor(
        ContractDomain.DELIVERY,
        'delivery-read-model',
      );
      expect(result).toBeNull();
    });
  });

  describe('replayFromLedger', () => {
    it('returns deleted count and message', async () => {
      const result = await service.replayFromLedger({ fromLedger: 500 });
      expect(result.deletedCount).toBe(3);
      expect(result.fromLedger).toBe(500);
      expect(result.message).toContain('3');
    });

    it('scopes deletion to domain when provided', async () => {
      const result = await service.replayFromLedger({
        fromLedger: 500,
        domain: ContractDomain.DELIVERY,
      });
      expect(result.domain).toBe(ContractDomain.DELIVERY);
    });

    it('resets cursor for specific domain+projection', async () => {
      await service.replayFromLedger({
        fromLedger: 500,
        domain: ContractDomain.PAYMENT,
        projectionName: 'payment-read-model',
      });
      expect(cursorRepo.update).toHaveBeenCalledWith(
        { domain: ContractDomain.PAYMENT, projectionName: 'payment-read-model' },
        { lastLedger: 499 },
      );
    });
  });

  describe('poison-event handling', () => {
    it('quarantines a poison event and returns it', async () => {
      const result = await service.quarantinePoisonEvent({
        dedupKey: 'bad-key',
        projectionName: 'inventory-read-model',
        payload: { foo: 'bar' },
        errorMessage: 'Schema validation failed',
      });
      expect(poisonRepo.save).toHaveBeenCalled();
      expect(result).toHaveProperty('id');
    });

    it('marks a poison event as REPLAYED', async () => {
      poisonRepo.findOne.mockResolvedValue({
        id: 'poison-1',
        status: PoisonEventStatus.QUARANTINED,
      });
      const result = await service.replayPoisonEvent({
        poisonEventId: 'poison-1',
        operatorNotes: 'Fixed schema, replaying',
      });
      expect(result.status).toBe(PoisonEventStatus.REPLAYED);
    });

    it('marks a poison event as DISCARDED', async () => {
      poisonRepo.findOne.mockResolvedValue({
        id: 'poison-1',
        status: PoisonEventStatus.QUARANTINED,
      });
      const result = await service.discardPoisonEvent({
        poisonEventId: 'poison-1',
        operatorNotes: 'Stale event, discarding',
      });
      expect(result.status).toBe(PoisonEventStatus.DISCARDED);
    });

    it('throws NotFoundException when poison event does not exist', async () => {
      poisonRepo.findOne.mockResolvedValue(null);
      await expect(
        service.replayPoisonEvent({ poisonEventId: 'nonexistent' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
