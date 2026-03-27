import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { SorobanService } from '../services/soroban.service';
import { IdempotencyService } from '../services/idempotency.service';
import { JobDeduplicationPlugin } from '../plugins/job-deduplication.plugin';

describe('DLQ Replay', () => {
  let service: SorobanService;
  let mockTxQueue: any;
  let mockDlq: any;
  let mockIdempotencyService: any;

  beforeEach(async () => {
    mockTxQueue = {
      add: jest.fn(),
      getJob: jest.fn(),
      count: jest.fn(),
      getFailedCount: jest.fn(),
    };

    mockDlq = {
      count: jest.fn(),
      getJobs: jest.fn(),
    };

    mockIdempotencyService = {
      checkAndSetIdempotencyKey: jest.fn(),
      clearIdempotencyKey: jest.fn(),
    };

    const mockDeduplicationPlugin = {
      checkAndSetJobDedup: jest.fn().mockResolvedValue(true),
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
      ],
    }).compile();

    service = module.get<SorobanService>(SorobanService);
  });

  describe('replayDlqJobs', () => {
    it('should perform dry run without replaying jobs', async () => {
      const mockJobs = [
        {
          id: 'job-1',
          data: {
            contractMethod: 'record_donation',
            idempotencyKey: 'donation-1',
            args: { donorId: 'donor-1' },
          },
        },
        {
          id: 'job-2',
          data: {
            contractMethod: 'record_donation',
            idempotencyKey: 'donation-2',
            args: { donorId: 'donor-2' },
          },
        },
      ];

      mockDlq.getJobs.mockResolvedValue(mockJobs);

      const result = await service.replayDlqJobs({
        dryRun: true,
        batchSize: 10,
        offset: 0,
      });

      expect(result.dryRun).toBe(true);
      expect(result.totalInspected).toBe(2);
      expect(result.replayable).toBe(2);
      expect(result.replayed).toBe(0);
      expect(mockIdempotencyService.clearIdempotencyKey).not.toHaveBeenCalled();
      expect(mockTxQueue.add).not.toHaveBeenCalled();
    });

    it('should replay valid jobs and clear idempotency keys', async () => {
      const mockJob = {
        id: 'job-1',
        data: {
          contractMethod: 'record_donation',
          idempotencyKey: 'donation-1',
          args: { donorId: 'donor-1' },
        },
        remove: jest.fn(),
      };

      mockDlq.getJobs.mockResolvedValue([mockJob]);
      mockIdempotencyService.clearIdempotencyKey.mockResolvedValue(true);
      mockIdempotencyService.checkAndSetIdempotencyKey.mockResolvedValue(true);
      mockTxQueue.add.mockResolvedValue({ id: 'new-job-1' });

      const result = await service.replayDlqJobs({
        dryRun: false,
        batchSize: 10,
        offset: 0,
      });

      expect(result.dryRun).toBe(false);
      expect(result.replayed).toBe(1);
      expect(mockIdempotencyService.clearIdempotencyKey).toHaveBeenCalledWith(
        'donation-1',
      );
      expect(mockTxQueue.add).toHaveBeenCalled();
      expect(mockJob.remove).toHaveBeenCalled();
    });

    it('should skip jobs with invalid data', async () => {
      const mockJobs = [
        {
          id: 'job-1',
          data: null,
        },
        {
          id: 'job-2',
          data: {
            contractMethod: 'record_donation',
            // Missing idempotencyKey
          },
        },
      ];

      mockDlq.getJobs.mockResolvedValue(mockJobs);

      const result = await service.replayDlqJobs({
        dryRun: false,
        batchSize: 10,
        offset: 0,
      });

      expect(result.skipped).toBe(2);
      expect(result.errors.length).toBe(2);
      expect(result.replayed).toBe(0);
    });

    it('should respect batch size limit', async () => {
      mockDlq.getJobs.mockResolvedValue([]);

      await service.replayDlqJobs({
        dryRun: true,
        batchSize: 50,
        offset: 10,
      });

      expect(mockDlq.getJobs).toHaveBeenCalledWith(['failed'], 10, 59);
    });

    it('should handle replay errors gracefully', async () => {
      const mockJob = {
        id: 'job-1',
        data: {
          contractMethod: 'record_donation',
          idempotencyKey: 'donation-1',
          args: { donorId: 'donor-1' },
        },
        remove: jest.fn(),
      };

      mockDlq.getJobs.mockResolvedValue([mockJob]);
      mockIdempotencyService.clearIdempotencyKey.mockRejectedValue(
        new Error('Redis connection failed'),
      );

      const result = await service.replayDlqJobs({
        dryRun: false,
        batchSize: 10,
        offset: 0,
      });

      expect(result.replayed).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].reason).toContain('Redis connection failed');
    });
  });
});
