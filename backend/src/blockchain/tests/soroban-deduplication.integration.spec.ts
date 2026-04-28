/// <reference types="jest" />

import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';

import { JobDeduplicationPlugin } from '../plugins/job-deduplication.plugin';
import { IdempotencyService } from '../services/idempotency.service';
import { ConfirmationService } from '../services/confirmation.service';
import { QueueMetricsService } from '../services/queue-metrics.service';
import { SorobanService } from '../services/soroban.service';
import { SorobanTxJob } from '../types/soroban-tx.types';

/* eslint-disable @typescript-eslint/no-unsafe-assignment */

describe('SorobanService - Job Deduplication Integration', () => {
  let service: SorobanService;
  let mockTxQueue: any;
  let mockDlq: any;
  let mockIdempotencyService: {
    checkAndSetIdempotencyKey: jest.Mock;
  };
  let mockDeduplicationPlugin: {
    checkAndSetJobDedup: jest.Mock;
    clearDedup: jest.Mock;
  };

  beforeEach(async () => {
    mockTxQueue = {
      add: jest
        .fn()
        .mockImplementation(
          (_name: string, _data: SorobanTxJob, opts: { jobId?: string } = {}) =>
            Promise.resolve({ id: opts.jobId ?? 'job-123' }),
        ),
      count: jest.fn().mockResolvedValue(0),
      getFailedCount: jest.fn().mockResolvedValue(0),
      getJob: jest.fn(),
    };

    mockDlq = {
      count: jest.fn().mockResolvedValue(0),
    };

    mockIdempotencyService = {
      checkAndSetIdempotencyKey: jest.fn().mockResolvedValue(true),
    };

    mockDeduplicationPlugin = {
      checkAndSetJobDedup: jest.fn().mockResolvedValue(true),
      clearDedup: jest.fn().mockResolvedValue(undefined),
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
          useValue: { recordConfirmations: jest.fn(), finalityThreshold: 1 },
        },
        {
          provide: QueueMetricsService,
          useValue: {
            getDetailedMetrics: jest.fn().mockResolvedValue({
              counters: {},
              timings: {},
              live: { waiting: 0, active: 0, failed: 0, dlqDepth: 0 },
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SorobanService>(SorobanService);
  });

  describe('submitTransaction with deduplication', () => {
    it('should pass through deduplication check for new job', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'register_blood',
        args: ['bank-123', 'O+', 100],
        idempotencyKey: 'new-tx-1',
      };

      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        true,
      );
      mockDeduplicationPlugin.checkAndSetJobDedup.mockResolvedValueOnce(true);

      const jobId = await service.submitTransaction(job);

      expect(jobId).toBe('new-tx-1');
      expect(mockDeduplicationPlugin.checkAndSetJobDedup).toHaveBeenCalledWith(
        'register_blood',
        ['bank-123', 'O+', 100],
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockTxQueue.add).toHaveBeenCalled();
    });

    it('should reject job if deduplication suppresses it', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'register_blood',
        args: ['bank-123', 'O+', 100],
        idempotencyKey: 'dup-tx-1',
      };

      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        true,
      );
      mockDeduplicationPlugin.checkAndSetJobDedup.mockResolvedValueOnce(false); // Suppressed

      await expect(service.submitTransaction(job)).rejects.toThrow(
        'Duplicate job - equivalent job enqueued recently',
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockTxQueue.add).not.toHaveBeenCalled();
    });

    it('should reject if idempotency key exists (even if dedup passes)', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'register_blood',
        args: ['bank-123', 'O+', 100],
        idempotencyKey: 'existing-key',
      };

      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        false,
      ); // Already exists

      await expect(service.submitTransaction(job)).rejects.toThrow(
        'Duplicate submission - idempotency key already exists',
      );

      // Should reject before checking dedup
      expect(
        mockDeduplicationPlugin.checkAndSetJobDedup,
      ).not.toHaveBeenCalled();
    });

    it('should suppress multiple rapid submissions of equivalent jobs', async () => {
      const job1: SorobanTxJob = {
        contractMethod: 'order_payment',
        args: ['order-456', 50],
        idempotencyKey: 'pay-1',
      };

      const job2: SorobanTxJob = {
        contractMethod: 'order_payment',
        args: ['order-456', 50], // Same payload, different idempotency key
        idempotencyKey: 'pay-2',
      };

      // First submission succeeds
      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        true,
      );
      mockDeduplicationPlugin.checkAndSetJobDedup.mockResolvedValueOnce(true);
      const result1 = await service.submitTransaction(job1);
      expect(result1).toBe('pay-1');

      // Second submission blocked by dedup (same payload)
      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        true,
      );
      mockDeduplicationPlugin.checkAndSetJobDedup.mockResolvedValueOnce(false); // Suppressed

      await expect(service.submitTransaction(job2)).rejects.toThrow(
        'Duplicate job - equivalent job enqueued recently',
      );

      // Verify only one job added to queue
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockTxQueue.add).toHaveBeenCalledTimes(1);
    });

    it('should allow same payload after dedup window expired', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'batch_operation',
        args: ['data-set'],
        idempotencyKey: 'batch-1',
      };

      // First submission
      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        true,
      );
      mockDeduplicationPlugin.checkAndSetJobDedup.mockResolvedValueOnce(true);
      const result1 = await service.submitTransaction(job);
      expect(result1).toBe('batch-1');

      // Same payload, new idempotency key, after dedup window
      const job2 = {
        ...job,
        idempotencyKey: 'batch-2',
      };

      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        true,
      );
      mockDeduplicationPlugin.checkAndSetJobDedup.mockResolvedValueOnce(true); // Window expired
      const result2 = await service.submitTransaction(job2);
      expect(result2).toBe('batch-2');

      // Verify both jobs added to queue
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockTxQueue.add).toHaveBeenCalledTimes(2);
    });

    it('should call dedup with correct contract method and args', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'complex_operation',
        args: [{ nested: { field: 'value' } }, [1, 2, 3], null, undefined],
        idempotencyKey: 'complex-1',
      };

      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
        true,
      );
      mockDeduplicationPlugin.checkAndSetJobDedup.mockResolvedValueOnce(true);

      await service.submitTransaction(job);

      expect(mockDeduplicationPlugin.checkAndSetJobDedup).toHaveBeenCalledWith(
        'complex_operation',
        [{ nested: { field: 'value' } }, [1, 2, 3], null, undefined],
      );
    });
  });

  describe('Job Deduplication Acceptance Tests', () => {
    it('should verify duplicate job suppression across high-volume submissions', async () => {
      const baseJob: SorobanTxJob = {
        contractMethod: 'user_event',
        args: ['user-123', 'login'],
        idempotencyKey: '',
      };

      // Simulate high-volume scenario: 10 rapid submissions of same event
      const results: { allowed: boolean; error?: string }[] = [];

      for (let i = 0; i < 10; i++) {
        const job = {
          ...baseJob,
          idempotencyKey: `event-${i}`,
        };

        mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValueOnce(
          true,
        );

        // Only first is allowed, rest are suppressed
        const isDedupNew = i === 0;
        mockDeduplicationPlugin.checkAndSetJobDedup.mockResolvedValueOnce(
          isDedupNew,
        );

        try {
          await service.submitTransaction(job);
          results.push({ allowed: true });
        } catch (error) {
          results.push({ allowed: false, error: (error as Error).message });
        }
      }

      // Verify only 1 allowed, 9 suppressed
      const allowedCount = results.filter((r) => r.allowed).length;
      expect(allowedCount).toBe(1);

      // Verify queue received only 1 job
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockTxQueue.add).toHaveBeenCalledTimes(1);
    });

    it('should demonstrate queue bloat prevention', async () => {
      const createJob = (index: number): SorobanTxJob => ({
        contractMethod: 'process_order',
        args: ['order-id', 100], // Repeated args
        idempotencyKey: `order-${index}`,
      });

      // Without deduplication, all 50 jobs would be queued
      // With deduplication, only 1 queued, 49 suppressed

      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValue(true);

      for (let i = 0; i < 50; i++) {
        const isDedupNew = i === 0;
        mockDeduplicationPlugin.checkAndSetJobDedup.mockResolvedValueOnce(
          isDedupNew,
        );

        try {
          await service.submitTransaction(createJob(i));
        } catch {
          // Suppress expected errors for duplicates
        }
      }

      // Only first job added to queue - bloat prevented
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockTxQueue.add).toHaveBeenCalledTimes(1);
    });
  });
});
