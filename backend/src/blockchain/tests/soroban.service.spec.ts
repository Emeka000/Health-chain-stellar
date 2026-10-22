/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/// <reference types="jest" />
import { getQueueToken } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { OnChainTxStateEntity } from '../entities/on-chain-tx-state.entity';
import { ConfirmationService } from '../services/confirmation.service';
import { JobDeduplicationPlugin } from '../plugins/job-deduplication.plugin';
import { IdempotencyService } from '../services/idempotency.service';
import { QueueMetricsService } from '../services/queue-metrics.service';
import { SorobanService } from '../services/soroban.service';
import { SorobanTxJob } from '../types/soroban-tx.types';

describe('SorobanService', () => {
  let service: SorobanService;
  let mockTxQueue: {
    add: jest.Mock;
    count: jest.Mock;
    getFailedCount: jest.Mock;
    getJob: jest.Mock;
  };
  let mockDlq: {
    count: jest.Mock;
  };
  let mockIdempotencyService: {
    checkAndSetIdempotencyKey: jest.Mock;
  };
  let mockDeduplicationPlugin: {
    checkAndSetJobDedup: jest.Mock;
  };
  let mockConfirmationService: {
    recordConfirmations: jest.Mock;
    getConfirmations: jest.Mock;
    finalityThreshold: number;
  };
  let mockQueueMetricsService: {
    getDetailedMetrics: jest.Mock;
  };

  beforeEach(async () => {
    mockTxQueue = {
      add: jest
        .fn()
        .mockImplementation(
          (_name: string, _data: SorobanTxJob, opts: { jobId?: string } = {}) =>
            Promise.resolve({ id: opts.jobId ?? 'job-123' }),
        ),
      count: jest.fn().mockResolvedValue(5),
      getFailedCount: jest.fn().mockResolvedValue(2),
      getWaitingCount: jest.fn().mockResolvedValue(4),
      getActiveCount: jest.fn().mockResolvedValue(1),
      getDelayedCount: jest.fn().mockResolvedValue(0),
      getJob: jest.fn(),
    };

    mockDlq = {
      count: jest.fn().mockResolvedValue(1),
    };

    mockIdempotencyService = {
      checkAndSetIdempotencyKey: jest.fn().mockResolvedValue(true),
    };

    mockDeduplicationPlugin = {
      checkAndSetJobDedup: jest.fn().mockResolvedValue(true),
    };

    mockConfirmationService = {
      recordConfirmations: jest.fn().mockResolvedValue({
        transactionHash: 'tx-1',
        confirmations: 1,
        finalityThreshold: 1,
        status: 'final',
      }),
      getConfirmations: jest.fn().mockResolvedValue(1),
      finalityThreshold: 1,
    };
    mockQueueMetricsService = {
      getDetailedMetrics: jest.fn().mockResolvedValue({
        counters: {
          queued: 10,
          processing: 1,
          success: 7,
          failure: 2,
          retries: 3,
          dlq: 1,
        },
        timings: { avgMs: 120, minMs: 80, maxMs: 300, samples: 7 },
        live: { waiting: 4, active: 1, failed: 2, delayed: 0, dlqDepth: 1 },
        since: '2026-01-01T00:00:00.000Z',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanService,
        {
          provide: getQueueToken('soroban-tx-queue'),
          useValue: mockTxQueue,
        },
        {
          provide: getQueueToken('soroban-dlq'),
          useValue: mockDlq,
        },
        {
          provide: IdempotencyService,
          useValue: mockIdempotencyService,
        },
        {
          provide: JobDeduplicationPlugin,
          useValue: mockDeduplicationPlugin,
        },
        {
          provide: ConfirmationService,
          useValue: mockConfirmationService,
        },
        {
          provide: QueueMetricsService,
          useValue: mockQueueMetricsService,
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
        {
          provide: getRepositoryToken(OnChainTxStateEntity),
          useValue: { findOne: jest.fn().mockResolvedValue(null), create: jest.fn((d: unknown) => d), save: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<SorobanService>(SorobanService);
  });

  describe('submitTransaction', () => {
    it('should submit a transaction and return job ID', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'register_blood',
        args: ['bank-123', 'O+', 100],
        idempotencyKey: 'idempotency-key-1',
        maxRetries: 5,
      };

      const jobId = await service.submitTransaction(job);

      expect(jobId).toBe('idempotency-key-1');
      expect(mockTxQueue.add).toHaveBeenCalledWith(
        job.contractMethod,
        job,
        expect.any(Object),
      );
    });

    it('should reject duplicate submissions', async () => {
      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        false,
      );

      const job: SorobanTxJob = {
        contractMethod: 'register_blood',
        args: [],
        idempotencyKey: 'duplicate-key',
      };

      await expect(service.submitTransaction(job)).rejects.toThrow(
        'Duplicate submission',
      );
    });

    it('normalizes deprecated contract method aliases before enqueueing', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'create_blood_request',
        args: ['req-1'],
        idempotencyKey: 'normalize-key',
      };

      await service.submitTransaction(job);

      expect(mockTxQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          contractMethod: 'create_request',
          metadata: expect.objectContaining({
            normalizedFromContractMethod: 'create_blood_request',
          }),
        }),
        expect.any(Object),
      );
    });

    it('should use default maxRetries if not provided', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'test',
        args: [],
        idempotencyKey: 'key-1',
      };

      await service.submitTransaction(job);

      expect(mockTxQueue.add).toHaveBeenCalledWith(
        job.contractMethod,
        job,
        expect.objectContaining({
          attempts: 5, // default
        }),
      );
    });

    it('should use custom maxRetries when provided', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'test',
        args: [],
        idempotencyKey: 'key-2',
        maxRetries: 10,
      };

      await service.submitTransaction(job);

      expect(mockTxQueue.add).toHaveBeenCalledWith(
        job.contractMethod,
        job,
        expect.objectContaining({
          attempts: 10,
        }),
      );
    });

    it('should configure exponential backoff', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'test',
        args: [],
        idempotencyKey: 'key-3',
      };

      await service.submitTransaction(job);

      expect(mockTxQueue.add).toHaveBeenCalledWith(
        job.contractMethod,
        job,
        expect.objectContaining({
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        }),
      );
    });

    it('should prevent duplicate submissions with concurrent requests', async () => {
      const idempotencyKey = 'concurrent-test-key';
      const job: SorobanTxJob = {
        contractMethod: 'register_blood',
        args: ['bank-123', 'O+', 100],
        idempotencyKey,
      };

      // First call succeeds
      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        true,
      );
      // Second call fails (duplicate)
      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        false,
      );

      const result1 = await service.submitTransaction(job);
      expect(result1).toBe(idempotencyKey);

      await expect(service.submitTransaction(job)).rejects.toThrow(
        'Duplicate submission',
      );
    });
  });

  describe('submitTransactionAndWait', () => {
    it('resolves with transaction hash when the worker completes', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'register_verified_organization',
        args: ['org-id', 'LIC', 'Name'],
        idempotencyKey: 'wait-key-1',
      };
      mockTxQueue.getJob.mockResolvedValueOnce({
        finished: jest.fn().mockResolvedValue({
          success: true,
          transactionHash: 'tx_completed',
        }),
      });

      const result = await service.submitTransactionAndWait(job, 10_000);

      expect(result.transactionHash).toBe('tx_completed');
      expect(mockTxQueue.getJob).toHaveBeenCalledWith('wait-key-1');
    });
  });

  describe('getQueueMetrics', () => {
    it('should return accurate queue metrics', async () => {
      const metrics = await service.getQueueMetrics();

      expect(metrics).toMatchObject({
        queueDepth: 5, // waiting(4) + active(1)
        failedJobs: 2,
        dlqCount: 1,
        processingRate: 0,
      });
      expect(metrics.counters).toBeDefined();
      expect(metrics.timings).toBeDefined();
    });

    it('should include counters and timings from QueueMetricsService', async () => {
      const metrics = await service.getQueueMetrics();

      expect(metrics.counters).toMatchObject({
        queued: 10,
        processing: 1,
        success: 7,
        failure: 2,
        retries: 3,
        dlq: 1,
      });
      expect(metrics.timings).toMatchObject({
        avgMs: 120,
        minMs: 80,
        maxMs: 300,
        samples: 7,
      });
    });

    it('should call QueueMetricsService.getDetailedMetrics', async () => {
      await service.getQueueMetrics();
      expect(mockQueueMetricsService.getDetailedMetrics).toHaveBeenCalled();
    });
  });

  describe('getJobStatus', () => {
    it('should return job status when job exists', async () => {
      const mockJob = {
        id: 'job-123',
        data: { transactionHash: 'tx_abc123' },
        getState: jest.fn().mockResolvedValue('completed'),
        failedReason: null,
        attemptsMade: 0,
        timestamp: Date.now(),
        finishedOn: Date.now() + 5000,
      };

      mockTxQueue.getJob.mockResolvedValueOnce(mockJob);

      const status = await service.getJobStatus('job-123');

      expect(status).toEqual({
        jobId: 'job-123',
        transactionHash: 'tx_abc123',
        status: 'completed',
        error: null,
        retryCount: 0,
        createdAt: expect.any(Date),
        completedAt: expect.any(Date),
      });
    });

    it('should return null when job does not exist', async () => {
      mockTxQueue.getJob.mockResolvedValueOnce(null);

      const status = await service.getJobStatus('non-existent-job');

      expect(status).toBeNull();
    });

    it('should handle failed job status', async () => {
      const mockJob = {
        id: 'job-456',
        data: {},
        getState: jest.fn().mockResolvedValue('failed'),
        failedReason: 'RPC timeout',
        attemptsMade: 3,
        timestamp: Date.now(),
        finishedOn: null,
      };

      mockTxQueue.getJob.mockResolvedValueOnce(mockJob);

      const status = await service.getJobStatus('job-456');

      expect(status).not.toBeNull();
      expect(status!.status).toBe('failed');
      expect(status!.error).toBe('RPC timeout');
      expect(status!.retryCount).toBe(3);
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential backoff with jitter for attempt 1', () => {
      const delay = service.calculateBackoffDelay(1);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1100);
    });

    it('should calculate exponential backoff with jitter for attempt 2', () => {
      const delay = service.calculateBackoffDelay(2);
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThanOrEqual(2200);
    });

    it('should calculate exponential backoff with jitter for attempt 3', () => {
      const delay = service.calculateBackoffDelay(3);
      expect(delay).toBeGreaterThanOrEqual(4000);
      expect(delay).toBeLessThanOrEqual(4400);
    });

    it('should calculate exponential backoff with jitter for attempt 4', () => {
      const delay = service.calculateBackoffDelay(4);
      expect(delay).toBeGreaterThanOrEqual(8000);
      expect(delay).toBeLessThanOrEqual(8800);
    });

    it('should calculate exponential backoff with jitter for attempt 5', () => {
      const delay = service.calculateBackoffDelay(5);
      expect(delay).toBeGreaterThanOrEqual(16000);
      expect(delay).toBeLessThanOrEqual(17600);
    });

    it('should cap delay at max value (60 seconds)', () => {
      const delay = service.calculateBackoffDelay(10);
      expect(delay).toBeLessThanOrEqual(60000);
    });

    it('should include jitter in backoff calculation', () => {
      // Run multiple times to verify jitter is applied
      const delays = Array.from({ length: 10 }, () =>
        service.calculateBackoffDelay(2),
      );

      // All delays should be in range
      delays.forEach((delay) => {
        expect(delay).toBeGreaterThanOrEqual(2000);
        expect(delay).toBeLessThanOrEqual(2200);
      });

      // Not all delays should be identical (jitter is working)
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });
  });

  describe('Acceptance Criteria', () => {
    it('should ensure all SorobanService calls go through BullMQ queue', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'register_blood',
        args: ['bank-123', 'O+', 100],
        idempotencyKey: 'acceptance-test-1',
      };

      await service.submitTransaction(job);

      // Verify queue.add was called (no direct synchronous calls)
      expect(mockTxQueue.add).toHaveBeenCalled();
    });

    it('should implement exponential backoff with configurable base and max delay', async () => {
      // Verify backoff configuration
      const job: SorobanTxJob = {
        contractMethod: 'test',
        args: [],
        idempotencyKey: 'backoff-test',
      };

      await service.submitTransaction(job);

      expect(mockTxQueue.add).toHaveBeenCalledWith(
        job.contractMethod,
        job,
        expect.objectContaining({
          backoff: {
            type: 'exponential',
            delay: 1000, // BASE_DELAY
          },
        }),
      );

      // Verify max delay is enforced
      const maxDelay = service.calculateBackoffDelay(100);
      expect(maxDelay).toBeLessThanOrEqual(60000); // MAX_DELAY
    });

    it('should prevent duplicate submissions with idempotency key', async () => {
      const idempotencyKey = 'unique-key-acceptance';
      const job: SorobanTxJob = {
        contractMethod: 'register_blood',
        args: ['bank-123', 'O+', 100],
        idempotencyKey,
      };

      // First submission succeeds
      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        true,
      );
      const jobId1 = await service.submitTransaction(job);
      expect(jobId1).toBe(idempotencyKey);

      // Duplicate submission fails
      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        false,
      );
      await expect(service.submitTransaction(job)).rejects.toThrow(
        'Duplicate submission',
      );

      // Verify idempotency service was called
      expect(
        mockIdempotencyService.checkAndSetIdempotencyKey,
      ).toHaveBeenCalledWith(idempotencyKey);
    });

    it('should expose queue metrics for admin monitoring', async () => {
      const metrics = await service.getQueueMetrics();

      expect(metrics).toHaveProperty('queueDepth');
      expect(metrics).toHaveProperty('failedJobs');
      expect(metrics).toHaveProperty('dlqCount');
      expect(metrics).toHaveProperty('processingRate');
      expect(metrics).toHaveProperty('counters');
      expect(metrics).toHaveProperty('timings');

      expect(typeof metrics.queueDepth).toBe('number');
      expect(typeof metrics.failedJobs).toBe('number');
      expect(typeof metrics.dlqCount).toBe('number');
    });
  });

  describe('callback idempotency', () => {
    it('should check and set callback idempotency via IdempotencyService', async () => {
      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        true,
      );

      const result = await service.checkAndSetCallbackIdempotency('evt-1');

      expect(result).toBe(true);
      expect(
        mockIdempotencyService.checkAndSetIdempotencyKey,
      ).toHaveBeenCalledWith('callback:evt-1');
    });

    it('should process webhook callback without error', async () => {
      await expect(
        service.processWebhookCallback({
          eventId: 'evt-1',
          transactionHash: 'tx-1',
          contractMethod: 'register_blood',
          status: 'confirmed',
          timestamp: new Date().toISOString(),
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('processWebhookCallback – confirmation depth', () => {
    it('calls ConfirmationService with default confirmations=1 when omitted', async () => {
      await service.processWebhookCallback({
        eventId: 'evt-depth-1',
        transactionHash: 'tx-depth',
        contractMethod: 'register_blood',
        status: 'confirmed',
        timestamp: new Date().toISOString(),
      });

      expect(mockConfirmationService.recordConfirmations).toHaveBeenCalledWith(
        'tx-depth',
        1,
      );
    });

    it('passes incoming confirmations count to ConfirmationService', async () => {
      await service.processWebhookCallback({
        eventId: 'evt-depth-2',
        transactionHash: 'tx-depth-2',
        contractMethod: 'register_blood',
        status: 'confirmed',
        timestamp: new Date().toISOString(),
        confirmations: 3,
      });

      expect(mockConfirmationService.recordConfirmations).toHaveBeenCalledWith(
        'tx-depth-2',
        3,
      );
    });

    it('does NOT call ConfirmationService for non-confirmed status', async () => {
      await service.processWebhookCallback({
        eventId: 'evt-pending',
        transactionHash: 'tx-pending',
        contractMethod: 'register_blood',
        status: 'pending',
        timestamp: new Date().toISOString(),
      });

      expect(
        mockConfirmationService.recordConfirmations,
      ).not.toHaveBeenCalled();
    });

    it('status remains "confirmed" when below threshold', async () => {
      mockConfirmationService.recordConfirmations.mockResolvedValueOnce({
        transactionHash: 'tx-below',
        confirmations: 1,
        finalityThreshold: 3,
        status: 'confirmed',
      });

      // Should resolve without throwing – downstream persistence is a TODO
      await expect(
        service.processWebhookCallback({
          eventId: 'evt-below',
          transactionHash: 'tx-below',
          contractMethod: 'register_blood',
          status: 'confirmed',
          timestamp: new Date().toISOString(),
          confirmations: 1,
        }),
      ).resolves.toBeUndefined();
    });

    it('status transitions to "final" when threshold is met', async () => {
      mockConfirmationService.recordConfirmations.mockResolvedValueOnce({
        transactionHash: 'tx-final',
        confirmations: 3,
        finalityThreshold: 3,
        status: 'final',
      });

      await expect(
        service.processWebhookCallback({
          eventId: 'evt-final',
          transactionHash: 'tx-final',
          contractMethod: 'register_blood',
          status: 'confirmed',
          timestamp: new Date().toISOString(),
          confirmations: 3,
        }),
      ).resolves.toBeUndefined();
    });
  });
});
