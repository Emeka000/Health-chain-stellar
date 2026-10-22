/// <reference types="jest" />
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OnChainTxStateEntity, OnChainTxStatus, TX_EVENT_BIT } from '../entities/on-chain-tx-state.entity';
import { ConfirmationService } from '../services/confirmation.service';
import { IdempotencyService } from '../services/idempotency.service';
import { JobDeduplicationPlugin } from '../plugins/job-deduplication.plugin';
import { QueueMetricsService } from '../services/queue-metrics.service';
import { SorobanService } from '../services/soroban.service';
import {
  TxConfirmedEvent,
  TxFailedEvent,
  TxFinalEvent,
  TxPendingEvent,
} from '../../events/blockchain-tx.events';

// ─── helpers ─────────────────────────────────────────────────────────────────

const TX_HASH = 'abc123txhash';
const CONTRACT_METHOD = 'verify_organization';

const makeCallback = (
  status: 'pending' | 'confirmed' | 'failed',
  overrides: Partial<{
    transactionHash: string;
    contractMethod: string;
    confirmations: number;
    details: string;
  }> = {},
) => ({
  eventId: `evt-${Date.now()}`,
  transactionHash: TX_HASH,
  contractMethod: CONTRACT_METHOD,
  status,
  timestamp: new Date().toISOString(),
  ...overrides,
});

function makeTxStateRepo(existing: OnChainTxStateEntity | null = null) {
  const saved: OnChainTxStateEntity[] = [];
  return {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn((data: Partial<OnChainTxStateEntity>) => ({ ...data } as OnChainTxStateEntity)),
    save: jest.fn(async (entity: OnChainTxStateEntity) => {
      saved.push({ ...entity });
      return entity;
    }),
    _saved: saved,
  };
}

async function buildService(
  txStateRepo: ReturnType<typeof makeTxStateRepo>,
  confirmationResult: { confirmations: number; finalityThreshold: number; status: 'confirmed' | 'final' } = {
    confirmations: 1,
    finalityThreshold: 1,
    status: 'final',
  },
) {
  const mockEventEmitter = { emit: jest.fn() };
  const mockConfirmationService = {
    recordConfirmations: jest.fn().mockResolvedValue({
      transactionHash: TX_HASH,
      ...confirmationResult,
    }),
    finalityThreshold: confirmationResult.finalityThreshold,
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SorobanService,
      { provide: getQueueToken('soroban-tx-queue'), useValue: { add: jest.fn().mockResolvedValue({ id: 'j1' }), getJob: jest.fn(), getJobs: jest.fn().mockResolvedValue([]) } },
      { provide: getQueueToken('soroban-dlq'), useValue: { getJobs: jest.fn().mockResolvedValue([]) } },
      { provide: IdempotencyService, useValue: { checkAndSetIdempotencyKey: jest.fn().mockResolvedValue(true), clearIdempotencyKey: jest.fn() } },
      { provide: JobDeduplicationPlugin, useValue: { checkAndSetJobDedup: jest.fn().mockResolvedValue(true) } },
      { provide: ConfirmationService, useValue: mockConfirmationService },
      { provide: QueueMetricsService, useValue: { getDetailedMetrics: jest.fn() } },
      { provide: EventEmitter2, useValue: mockEventEmitter },
      { provide: getRepositoryToken(OnChainTxStateEntity), useValue: txStateRepo },
    ],
  }).compile();

  return {
    service: module.get(SorobanService),
    eventEmitter: mockEventEmitter,
    confirmationService: mockConfirmationService,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('SorobanService.processWebhookCallback', () => {
  describe('pending status', () => {
    it('persists state and emits TxPendingEvent', async () => {
      const repo = makeTxStateRepo();
      const { service, eventEmitter } = await buildService(repo);

      await service.processWebhookCallback(makeCallback('pending'));

      expect(repo.save).toHaveBeenCalled();
      const saved = repo._saved[0];
      expect(saved.emittedEvents & TX_EVENT_BIT.PENDING).toBeTruthy();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'blockchain.tx.pending',
        expect.any(TxPendingEvent),
      );
    });

    it('does not emit TxPendingEvent twice on retry', async () => {
      const existing = {
        transactionHash: TX_HASH,
        contractMethod: CONTRACT_METHOD,
        status: OnChainTxStatus.PENDING,
        confirmations: 0,
        finalityThreshold: 1,
        emittedEvents: TX_EVENT_BIT.PENDING, // already emitted
        failureReason: null,
        metadata: null,
      } as OnChainTxStateEntity;

      const repo = makeTxStateRepo(existing);
      const { service, eventEmitter } = await buildService(repo);

      await service.processWebhookCallback(makeCallback('pending'));

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('confirmed status – below finality threshold', () => {
    it('persists confirmed state and emits TxConfirmedEvent', async () => {
      const repo = makeTxStateRepo();
      const { service, eventEmitter } = await buildService(repo, {
        confirmations: 1,
        finalityThreshold: 3,
        status: 'confirmed',
      });

      await service.processWebhookCallback(makeCallback('confirmed', { confirmations: 1 }));

      const saved = repo._saved[0];
      expect(saved.status).toBe(OnChainTxStatus.CONFIRMED);
      expect(saved.emittedEvents & TX_EVENT_BIT.CONFIRMED).toBeTruthy();
      expect(saved.emittedEvents & TX_EVENT_BIT.FINAL).toBeFalsy();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'blockchain.tx.confirmed',
        expect.any(TxConfirmedEvent),
      );
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'blockchain.tx.final',
        expect.anything(),
      );
    });

    it('does not emit TxConfirmedEvent twice on retry', async () => {
      const existing = {
        transactionHash: TX_HASH,
        contractMethod: CONTRACT_METHOD,
        status: OnChainTxStatus.CONFIRMED,
        confirmations: 1,
        finalityThreshold: 3,
        emittedEvents: TX_EVENT_BIT.CONFIRMED,
        failureReason: null,
        metadata: null,
      } as OnChainTxStateEntity;

      const repo = makeTxStateRepo(existing);
      const { service, eventEmitter } = await buildService(repo, {
        confirmations: 2,
        finalityThreshold: 3,
        status: 'confirmed',
      });

      await service.processWebhookCallback(makeCallback('confirmed', { confirmations: 1 }));

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('confirmed status – reaches finality threshold', () => {
    it('persists final state and emits TxConfirmedEvent + TxFinalEvent', async () => {
      const repo = makeTxStateRepo();
      const { service, eventEmitter } = await buildService(repo, {
        confirmations: 3,
        finalityThreshold: 3,
        status: 'final',
      });

      await service.processWebhookCallback(makeCallback('confirmed', { confirmations: 3 }));

      const saved = repo._saved[repo._saved.length - 1];
      expect(saved.status).toBe(OnChainTxStatus.FINAL);
      expect(saved.emittedEvents & TX_EVENT_BIT.CONFIRMED).toBeTruthy();
      expect(saved.emittedEvents & TX_EVENT_BIT.FINAL).toBeTruthy();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'blockchain.tx.confirmed',
        expect.any(TxConfirmedEvent),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'blockchain.tx.final',
        expect.any(TxFinalEvent),
      );
    });

    it('does not emit TxFinalEvent twice when already final', async () => {
      const existing = {
        transactionHash: TX_HASH,
        contractMethod: CONTRACT_METHOD,
        status: OnChainTxStatus.FINAL,
        confirmations: 3,
        finalityThreshold: 3,
        emittedEvents: TX_EVENT_BIT.CONFIRMED | TX_EVENT_BIT.FINAL,
        failureReason: null,
        metadata: null,
      } as OnChainTxStateEntity;

      const repo = makeTxStateRepo(existing);
      const { service, eventEmitter } = await buildService(repo, {
        confirmations: 4,
        finalityThreshold: 3,
        status: 'final',
      });

      await service.processWebhookCallback(makeCallback('confirmed', { confirmations: 1 }));

      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'blockchain.tx.final',
        expect.anything(),
      );
    });
  });

  describe('failed status', () => {
    it('persists failed state and emits TxFailedEvent', async () => {
      const repo = makeTxStateRepo();
      const { service, eventEmitter } = await buildService(repo);

      await service.processWebhookCallback(
        makeCallback('failed', { details: 'contract execution error' }),
      );

      const saved = repo._saved[0];
      expect(saved.status).toBe(OnChainTxStatus.FAILED);
      expect(saved.failureReason).toBe('contract execution error');
      expect(saved.emittedEvents & TX_EVENT_BIT.FAILED).toBeTruthy();

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'blockchain.tx.failed',
        expect.any(TxFailedEvent),
      );
    });

    it('does not emit TxFailedEvent twice on retry', async () => {
      const existing = {
        transactionHash: TX_HASH,
        contractMethod: CONTRACT_METHOD,
        status: OnChainTxStatus.FAILED,
        confirmations: 0,
        finalityThreshold: 1,
        emittedEvents: TX_EVENT_BIT.FAILED,
        failureReason: 'original error',
        metadata: null,
      } as OnChainTxStateEntity;

      const repo = makeTxStateRepo(existing);
      const { service, eventEmitter } = await buildService(repo);

      await service.processWebhookCallback(makeCallback('failed'));

      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('event payload correctness', () => {
    it('TxConfirmedEvent carries correct confirmations and threshold', async () => {
      const repo = makeTxStateRepo();
      const { service, eventEmitter } = await buildService(repo, {
        confirmations: 2,
        finalityThreshold: 5,
        status: 'confirmed',
      });

      await service.processWebhookCallback(makeCallback('confirmed', { confirmations: 2 }));

      const [, event] = eventEmitter.emit.mock.calls[0] as [string, TxConfirmedEvent];
      expect(event.confirmations).toBe(2);
      expect(event.finalityThreshold).toBe(5);
      expect(event.transactionHash).toBe(TX_HASH);
      expect(event.contractMethod).toBe(CONTRACT_METHOD);
    });

    it('TxFailedEvent carries failure reason', async () => {
      const repo = makeTxStateRepo();
      const { service, eventEmitter } = await buildService(repo);

      await service.processWebhookCallback(
        makeCallback('failed', { details: 'out of gas' }),
      );

      const [, event] = eventEmitter.emit.mock.calls[0] as [string, TxFailedEvent];
      expect(event.failureReason).toBe('out of gas');
    });
  });
});
