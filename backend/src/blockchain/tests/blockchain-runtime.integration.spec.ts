/// <reference types="jest" />

import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { CompensationService } from '../../common/compensation/compensation.service';
import { CompensationAction } from '../../common/errors/app-errors';
import { BlockchainController } from '../controllers/blockchain.controller';
import { FailedSorobanTxEntity } from '../entities/failed-soroban-tx.entity';
import { AdminGuard } from '../guards/admin.guard';
import { JobDeduplicationPlugin } from '../plugins/job-deduplication.plugin';
import { SorobanDlqProcessor } from '../processors/soroban-dlq.processor';
import { SorobanTxProcessor } from '../processors/soroban-tx.processor';
import { BlockchainHealthService } from '../services/blockchain-health.service';
import { ConfirmationService } from '../services/confirmation.service';
import { FailedSorobanTxService } from '../services/failed-soroban-tx.service';
import { IdempotencyService } from '../services/idempotency.service';
import { QueueMetricsService } from '../services/queue-metrics.service';
import { SorobanService } from '../services/soroban.service';

function makeQueueMock() {
  return {
    add: jest
      .fn()
      .mockImplementation(
        (_name: string, _data: unknown, opts: { jobId?: string } = {}) =>
          Promise.resolve({ id: opts.jobId ?? 'job-1' }),
      ),
    on: jest.fn(),
    getJob: jest.fn().mockResolvedValue(null),
    getJobs: jest.fn().mockResolvedValue([]),
    getWaitingCount: jest.fn().mockResolvedValue(3),
    getActiveCount: jest.fn().mockResolvedValue(2),
    getFailedCount: jest.fn().mockResolvedValue(1),
    getDelayedCount: jest.fn().mockResolvedValue(0),
    count: jest.fn().mockResolvedValue(4),
  };
}

describe('Blockchain runtime provider graph', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      exists: jest.fn().mockResolvedValue(0),
      del: jest.fn().mockResolvedValue(1),
      quit: jest.fn().mockResolvedValue(undefined),
    };

    const failedTxRepository = {
      create: jest.fn((record) => record),
      save: jest.fn((record) => Promise.resolve({ ...record, id: 'failed-1' })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BlockchainController],
      providers: [
        SorobanService,
        QueueMetricsService,
        IdempotencyService,
        JobDeduplicationPlugin,
        ConfirmationService,
        FailedSorobanTxService,
        BlockchainHealthService,
        SorobanTxProcessor,
        SorobanDlqProcessor,
        AdminGuard,
        {
          provide: CompensationService,
          useValue: {
            compensate: jest.fn().mockResolvedValue({
              applied: [CompensationAction.PERSIST_DLQ],
              failed: [],
              failureRecordId: 'failure-1',
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'BLOCKCHAIN_CALLBACK_SECRET' ? 'secret' : undefined,
            ),
          },
        },
        { provide: 'REDIS_CLIENT', useValue: redis },
        {
          provide: getRepositoryToken(FailedSorobanTxEntity),
          useValue: failedTxRepository,
        },
        {
          provide: getQueueToken('soroban-tx-queue'),
          useValue: makeQueueMock(),
        },
        { provide: getQueueToken('soroban-dlq'), useValue: makeQueueMock() },
      ],
    })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('resolves queue metrics through the real Nest provider graph', () => {
    expect(app.get(QueueMetricsService)).toBeInstanceOf(QueueMetricsService);
    expect(app.get(SorobanService)).toBeInstanceOf(SorobanService);
    expect(app.get(BlockchainController)).toBeInstanceOf(BlockchainController);
  });

  it('serves queue/admin metrics through real controller and service instances', async () => {
    const controller = app.get(BlockchainController);

    await expect(controller.getDetailedMetrics()).resolves.toMatchObject({
      live: { waiting: 3, active: 2, failed: 1, dlqDepth: 4 },
    });

    await expect(controller.getQueueStatus()).resolves.toMatchObject({
      queueDepth: 5,
      failedJobs: 1,
      dlqCount: 4,
    });

    await expect(controller.getPrometheusMetrics()).resolves.toContain(
      'soroban_queue_dlq_depth 4',
    );
  });
});
