/* eslint-disable @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-argument,@typescript-eslint/unbound-method */
/// <reference types="jest" />

import { createHmac } from 'crypto';

import { Test, TestingModule } from '@nestjs/testing';

import { Request } from 'express';

import { BlockchainController } from '../controllers/blockchain.controller';
import { AdminGuard } from '../guards/admin.guard';
import { QueueMetricsService } from '../services/queue-metrics.service';
import { SorobanService } from '../services/soroban.service';
import { SorobanTxJob } from '../types/soroban-tx.types';

const BASE_METRICS: QueueMetrics = {
  queueDepth: 5,
  failedJobs: 2,
  dlqCount: 1,
  processingRate: 0,
  counters: {
    queued: 10,
    processing: 1,
    success: 7,
    failure: 2,
    retries: 3,
    dlq: 1,
  },
  timings: { avgMs: 120, minMs: 80, maxMs: 300, samples: 7 },
};

describe('BlockchainController', () => {
  let controller: BlockchainController;
  let mockSorobanService: jest.Mocked<SorobanService>;

  beforeEach(async () => {
    mockSorobanService = {
      submitTransaction: jest.fn().mockResolvedValue('job-123'),
      getQueueMetrics: jest.fn().mockResolvedValue(BASE_METRICS),
      getJobStatus: jest.fn().mockResolvedValue({
        jobId: 'job-123',
        transactionHash: 'tx_abc123',
        status: 'completed',
        error: null,
        retryCount: 0,
        createdAt: new Date(),
        completedAt: new Date(),
      }),
      processWebhookCallback: jest.fn().mockResolvedValue(undefined),
      checkAndSetCallbackIdempotency: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SorobanService>;

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
        live: { waiting: 3, active: 1, failed: 2, delayed: 0, dlqDepth: 1 },
        since: '2026-01-01T00:00:00.000Z',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlockchainController],
      providers: [
        { provide: SorobanService, useValue: mockSorobanService },
        { provide: QueueMetricsService, useValue: mockQueueMetricsService },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BlockchainController>(BlockchainController);
  });

  describe('submitTransaction', () => {
    it('should submit a transaction and return job ID', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'register_blood',
        args: ['bank-123', 'O+', 100],
        idempotencyKey: 'test-key-1',
      };

      const result = await controller.submitTransaction(job);

      expect(result).toEqual({ jobId: 'job-123' });
      expect(mockSorobanService.submitTransaction).toHaveBeenCalledWith(job);
    });

    it('should return 202 Accepted status', async () => {
      const job: SorobanTxJob = {
        contractMethod: 'test',
        args: [],
        idempotencyKey: 'test-key-2',
      };

      await controller.submitTransaction(job);
      expect(mockSorobanService.submitTransaction).toHaveBeenCalled();
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue metrics', async () => {
      const metrics = await controller.getQueueStatus();

      expect(metrics).toMatchObject({
        queueDepth: 5,
        failedJobs: 2,
        dlqCount: 1,
        processingRate: 0,
      });
      expect(mockSorobanService.getQueueMetrics).toHaveBeenCalled();
    });

    it('should include all required metrics fields', async () => {
      const metrics = await controller.getQueueStatus();

      expect(metrics).toHaveProperty('queueDepth');
      expect(metrics).toHaveProperty('failedJobs');
      expect(metrics).toHaveProperty('dlqCount');
      expect(metrics).toHaveProperty('counters');
      expect(metrics).toHaveProperty('timings');
    });
  });

  describe('processCallback', () => {
    const canonicalizePayload = (obj: Record<string, any>): string => {
      const sorted = Object.keys(obj)
        .sort()
        .reduce<Record<string, any>>((acc, key) => {
          const value = obj[key];
          if (value && typeof value === 'object' && !Array.isArray(value)) {
            acc[key] = canonicalizePayload(value);
          } else {
            acc[key] = value;
          }
          return acc;
        }, {});

      return JSON.stringify(sorted);
    };

    it('should process blockchain callback with valid signature and payload', async () => {
      process.env.BLOCKCHAIN_CALLBACK_SECRET = 'test-secret';

      const payload = {
        eventId: 'evt-1',
        transactionHash: 'tx-1',
        contractMethod: 'register_blood',
        status: 'confirmed',
        timestamp: new Date().toISOString(),
        details: 'completed',
      };

      const signature = createHmac('sha256', 'test-secret')
        .update(canonicalizePayload(payload))
        .digest('hex');

      const req = {
        headers: { 'x-webhook-signature': signature },
      } as unknown as Request;
      const body = payload as unknown as BlockchainCallbackDto;

      const result = await controller.processCallback(body, req);

      expect(result).toEqual({ success: true });
      expect(mockSorobanService.processWebhookCallback).toHaveBeenCalledWith(
        payload,
      );
    });

    it('should reject callback with invalid signature', async () => {
      process.env.BLOCKCHAIN_CALLBACK_SECRET = 'test-secret';

      const payload = {
        eventId: 'evt-2',
        transactionHash: 'tx-2',
        contractMethod: 'register_blood',
        status: 'confirmed',
        timestamp: new Date().toISOString(),
      };

      const req = {
        headers: { 'x-webhook-signature': 'invalid' },
      } as unknown as Request;
      const body = payload as unknown as BlockchainCallbackDto;

      await expect(controller.processCallback(body, req)).rejects.toThrow(
        'Invalid signature',
      );
    });

    it('should reject replayed callback', async () => {
      process.env.BLOCKCHAIN_CALLBACK_SECRET = 'test-secret';

      const payload = {
        eventId: 'evt-replay',
        transactionHash: 'tx-3',
        contractMethod: 'register_blood',
        status: 'confirmed',
        timestamp: new Date().toISOString(),
      };

      const signature = createHmac('sha256', 'test-secret')
        .update(canonicalizePayload(payload))
        .digest('hex');

      mockSorobanService.checkAndSetCallbackIdempotency.mockResolvedValueOnce(
        false,
      );

      const req = {
        headers: { 'x-webhook-signature': signature },
      } as unknown as Request;
      const body = payload as unknown as BlockchainCallbackDto;

      await expect(controller.processCallback(body, req)).rejects.toThrow(
        'Replay callback detected',
      );
    });
  });

  describe('getJobStatus', () => {
    it('should return job status for valid job ID', async () => {
      const status = await controller.getJobStatus('job-123');

      expect(status).toEqual({
        jobId: 'job-123',
        transactionHash: 'tx_abc123',
        status: 'completed',
        error: null,
        retryCount: 0,
        createdAt: expect.any(Date),
        completedAt: expect.any(Date),
      });
      expect(mockSorobanService.getJobStatus).toHaveBeenCalledWith('job-123');
    });

    it('should return null for non-existent job', async () => {
      mockSorobanService.getJobStatus.mockResolvedValueOnce(null);
      const status = await controller.getJobStatus('non-existent-job');
      expect(status).toBeNull();
    });

    it('should handle failed job status', async () => {
      mockSorobanService.getJobStatus.mockResolvedValueOnce({
        jobId: 'job-456',
        transactionHash: undefined,
        status: 'failed',
        error: 'RPC timeout',
        retryCount: 3,
        createdAt: new Date(),
        completedAt: undefined,
      });

      const status = await controller.getJobStatus('job-456');

      expect(status).not.toBeNull();
      expect(status!.status).toBe('failed');
      expect(status!.error).toBe('RPC timeout');
      expect(status!.retryCount).toBe(3);
    });
  });
});
