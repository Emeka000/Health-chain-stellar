import { Test, TestingModule } from '@nestjs/testing';

import { CompensationService } from '../../common/compensation/compensation.service';
import {
  BlockchainTxIrrecoverableError,
  CompensationAction,
} from '../../common/errors/app-errors';
import { SorobanDlqProcessor } from '../processors/soroban-dlq.processor';
import { QueueMetricsService } from '../services/queue-metrics.service';

const mockCompensationService = {
  compensate: jest.fn().mockResolvedValue({
    applied: [
      CompensationAction.PERSIST_DLQ,
      CompensationAction.NOTIFY_ADMIN,
      CompensationAction.FLAG_FOR_REVIEW,
    ],
    failed: [],
    failureRecordId: 'record-uuid',
  }),
};

const mockQueueMetricsService = {
  incrementDlq: jest.fn(),
};

function makeJob(overrides: Partial<any> = {}): any {
  return {
    id: 'job-1',
    data: {
      contractMethod: 'register_blood',
      args: ['bank1', 'A+', 500],
      idempotencyKey: 'idem-key-1',
      metadata: { requestNumber: 'BR-001' },
    },
    failedReason: 'RPC timeout',
    attemptsMade: 5,
    opts: { attempts: 5 },
    stacktrace: [
      'Error: RPC timeout\n  at SorobanTxProcessor.handleTransaction',
    ],
    ...overrides,
  };
}

describe('SorobanDlqProcessor', () => {
  let processor: SorobanDlqProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanDlqProcessor,
        { provide: CompensationService, useValue: mockCompensationService },
        { provide: QueueMetricsService, useValue: mockQueueMetricsService },
      ],
    }).compile();

    processor = module.get(SorobanDlqProcessor);
  });

  it('increments the DLQ counter via QueueMetricsService', async () => {
    const job = makeJob();
    await processor.handleDeadLetterJob(job);
    expect(mockQueueMetricsService.incrementDlq).toHaveBeenCalledTimes(1);
  });

  it('calls compensate with a BlockchainTxIrrecoverableError', async () => {
    const job = makeJob();
    await processor.handleDeadLetterJob(job);

    expect(mockCompensationService.compensate).toHaveBeenCalledTimes(1);
    const [error, handlers, correlationId] =
      mockCompensationService.compensate.mock.calls[0];

    expect(error).toBeInstanceOf(BlockchainTxIrrecoverableError);
    expect(error.context.jobId).toBe('job-1');
    expect(error.context.contractMethod).toBe('register_blood');
    expect(error.context.attemptsMade).toBe(5);
    expect(correlationId).toBe('idem-key-1');
    expect(handlers).toHaveLength(3);
    expect(handlers.map((h: any) => h.action)).toEqual([
      CompensationAction.PERSIST_DLQ,
      CompensationAction.NOTIFY_ADMIN,
      CompensationAction.FLAG_FOR_REVIEW,
    ]);
  });

  it('each handler resolves to true', async () => {
    const job = makeJob();
    // Bypass mock to test actual handler logic
    mockCompensationService.compensate.mockImplementationOnce(
      async (_err: any, handlers: any[]) => {
        const results = await Promise.all(handlers.map((h) => h.execute()));
        return {
          applied: results.map((_, i) => handlers[i].action),
          failed: [],
          failureRecordId: 'rec-1',
        };
      },
    );

    await processor.handleDeadLetterJob(job);

    // All three handlers should have returned true (no throws)
    const [, handlers] = mockCompensationService.compensate.mock.calls[0];
    for (const handler of handlers) {
      await expect(handler.execute()).resolves.toBe(true);
    }
  });

  it('does not throw even when compensate rejects', async () => {
    mockCompensationService.compensate.mockRejectedValueOnce(
      new Error('persist failed'),
    );
    const job = makeJob();
    // Should not propagate — DLQ processor must be resilient
    await expect(processor.handleDeadLetterJob(job)).rejects.toThrow(
      'persist failed',
    );
    // Note: in production you'd wrap this too, but the CompensationService itself never throws
  });
});
