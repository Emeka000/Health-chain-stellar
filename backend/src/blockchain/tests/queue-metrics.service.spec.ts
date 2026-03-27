/// <reference types="jest" />
import { getQueueToken } from '@nestjs/bull';
import { Test, TestingModule } from '@nestjs/testing';

import { QueueMetricsService } from '../services/queue-metrics.service';

/** Minimal Bull Queue mock with event emitter support. */
function makeMockQueue(overrides: Record<string, jest.Mock> = {}) {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  return {
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    }),
    emit: (event: string, ...args: unknown[]) => {
      (listeners[event] ?? []).forEach((cb) => cb(...args));
    },
    getWaitingCount: jest.fn().mockResolvedValue(3),
    getActiveCount: jest.fn().mockResolvedValue(1),
    getFailedCount: jest.fn().mockResolvedValue(2),
    getDelayedCount: jest.fn().mockResolvedValue(0),
    count: jest.fn().mockResolvedValue(1),
    ...overrides,
  };
}

describe('QueueMetricsService', () => {
  let service: QueueMetricsService;
  let txQueue: ReturnType<typeof makeMockQueue>;
  let dlqQueue: ReturnType<typeof makeMockQueue>;

  beforeEach(async () => {
    txQueue = makeMockQueue();
    dlqQueue = makeMockQueue();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueMetricsService,
        { provide: getQueueToken('soroban-tx-queue'), useValue: txQueue },
        { provide: getQueueToken('soroban-dlq'), useValue: dlqQueue },
      ],
    }).compile();

    service = module.get<QueueMetricsService>(QueueMetricsService);
    // Trigger onModuleInit to attach listeners
    service.onModuleInit();
  });

  afterEach(() => {
    service.reset();
  });

  // ─── Counter tests ──────────────────────────────────────────────────────────

  describe('queued counter', () => {
    it('increments when a job enters the waiting state', () => {
      txQueue.emit('waiting', 'job-1');
      txQueue.emit('waiting', 'job-2');

      expect(service['counters'].queued).toBe(2);
    });
  });

  describe('processing counter', () => {
    it('increments when a job becomes active', () => {
      txQueue.emit('active', {
        id: 'job-1',
        opts: { attempts: 5 },
        attemptsMade: 0,
      });
      expect(service['counters'].processing).toBe(1);
    });

    it('decrements when a job completes', () => {
      txQueue.emit('active', {
        id: 'job-1',
        opts: { attempts: 5 },
        attemptsMade: 0,
      });
      txQueue.emit('completed', {
        id: 'job-1',
        opts: { attempts: 5 },
        attemptsMade: 0,
      });
      expect(service['counters'].processing).toBe(0);
    });

    it('does not go below zero', () => {
      txQueue.emit('completed', {
        id: 'job-1',
        opts: { attempts: 5 },
        attemptsMade: 0,
      });
      expect(service['counters'].processing).toBe(0);
    });
  });

  describe('success counter', () => {
    it('increments on job completion', () => {
      txQueue.emit('completed', {
        id: 'job-1',
        opts: { attempts: 5 },
        attemptsMade: 0,
      });
      txQueue.emit('completed', {
        id: 'job-2',
        opts: { attempts: 5 },
        attemptsMade: 0,
      });
      expect(service['counters'].success).toBe(2);
    });
  });

  describe('failure counter', () => {
    it('increments on job failure', () => {
      txQueue.emit(
        'failed',
        { id: 'job-1', opts: { attempts: 5 }, attemptsMade: 4 },
        new Error('rpc'),
      );
      expect(service['counters'].failure).toBe(1);
    });
  });

  describe('retries counter', () => {
    it('increments when a failed job has remaining attempts', () => {
      // attemptsMade=1, attempts=5 → 3 remaining → retry
      txQueue.emit(
        'failed',
        { id: 'job-1', opts: { attempts: 5 }, attemptsMade: 1 },
        new Error('rpc'),
      );
      expect(service['counters'].retries).toBe(1);
    });

    it('does not increment retry when no attempts remain', () => {
      // attemptsMade=4, attempts=5 → 0 remaining → no retry
      txQueue.emit(
        'failed',
        { id: 'job-1', opts: { attempts: 5 }, attemptsMade: 4 },
        new Error('rpc'),
      );
      expect(service['counters'].retries).toBe(0);
    });

    it('increments on stalled job', () => {
      txQueue.emit('stalled', { id: 'job-1' });
      expect(service['counters'].retries).toBe(1);
    });
  });

  describe('DLQ counter', () => {
    it('increments via incrementDlq()', () => {
      service.incrementDlq();
      service.incrementDlq();
      expect(service['counters'].dlq).toBe(2);
    });

    it('does not double-count via queue event (only processor call counts)', () => {
      // The DLQ 'active' event is intentionally NOT listened to — only
      // the processor's explicit incrementDlq() call is the source of truth.
      dlqQueue.emit('active', { id: 'dlq-job-1' });
      expect(service['counters'].dlq).toBe(0); // no listener, no increment
    });
  });

  // ─── Timing tests ───────────────────────────────────────────────────────────

  describe('processing timings', () => {
    it('records timing for completed jobs', () => {
      const jobId = 'timed-job-1';
      // Simulate active → completed with a known start time
      service['jobStartTimes'].set(jobId, Date.now() - 100);
      txQueue.emit('completed', {
        id: jobId,
        opts: { attempts: 5 },
        attemptsMade: 0,
      });

      const timings = service['buildTimings']();
      expect(timings.samples).toBe(1);
      expect(timings.avgMs).toBeGreaterThanOrEqual(90);
      expect(timings.minMs).toBeGreaterThanOrEqual(90);
      expect(timings.maxMs).toBeGreaterThanOrEqual(90);
    });

    it('returns zero timings when no jobs have completed', () => {
      const timings = service['buildTimings']();
      expect(timings.samples).toBe(0);
      expect(timings.avgMs).toBe(0);
      expect(timings.minMs).toBe(0);
      expect(timings.maxMs).toBe(0);
    });

    it('tracks min and max across multiple jobs', () => {
      service['jobStartTimes'].set('j1', Date.now() - 50);
      txQueue.emit('completed', {
        id: 'j1',
        opts: { attempts: 5 },
        attemptsMade: 0,
      });

      service['jobStartTimes'].set('j2', Date.now() - 200);
      txQueue.emit('completed', {
        id: 'j2',
        opts: { attempts: 5 },
        attemptsMade: 0,
      });

      const timings = service['buildTimings']();
      expect(timings.samples).toBe(2);
      expect(timings.minMs).toBeLessThan(timings.maxMs);
    });
  });

  // ─── getDetailedMetrics ─────────────────────────────────────────────────────

  describe('getDetailedMetrics', () => {
    it('returns all required fields', async () => {
      const metrics = await service.getDetailedMetrics();

      expect(metrics).toHaveProperty('counters');
      expect(metrics).toHaveProperty('timings');
      expect(metrics).toHaveProperty('live');
      expect(metrics).toHaveProperty('since');

      expect(metrics.counters).toMatchObject({
        queued: expect.any(Number),
        processing: expect.any(Number),
        success: expect.any(Number),
        failure: expect.any(Number),
        retries: expect.any(Number),
        dlq: expect.any(Number),
      });

      expect(metrics.timings).toMatchObject({
        avgMs: expect.any(Number),
        minMs: expect.any(Number),
        maxMs: expect.any(Number),
        samples: expect.any(Number),
      });

      expect(metrics.live).toMatchObject({
        waiting: 3,
        active: 1,
        failed: 2,
        delayed: 0,
        dlqDepth: 1,
      });
    });

    it('reflects live queue counts from Bull', async () => {
      txQueue.getWaitingCount.mockResolvedValueOnce(10);
      txQueue.getActiveCount.mockResolvedValueOnce(2);

      const metrics = await service.getDetailedMetrics();
      expect(metrics.live.waiting).toBe(10);
      expect(metrics.live.active).toBe(2);
    });
  });

  // ─── reset ──────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('zeroes all counters', () => {
      service.incrementDlq();
      service.incrementRetry();
      txQueue.emit('waiting', 'j1');

      service.reset();

      expect(service['counters']).toEqual({
        queued: 0,
        processing: 0,
        success: 0,
        failure: 0,
        retries: 0,
        dlq: 0,
      });
    });

    it('resets timing state', () => {
      service['jobStartTimes'].set('j1', Date.now() - 100);
      txQueue.emit('completed', {
        id: 'j1',
        opts: { attempts: 5 },
        attemptsMade: 0,
      });

      service.reset();

      const timings = service['buildTimings']();
      expect(timings.samples).toBe(0);
    });

    it('updates the since timestamp', () => {
      const before = service['since'];
      service.reset();
      expect(service['since']).not.toBe(before);
    });
  });
});
