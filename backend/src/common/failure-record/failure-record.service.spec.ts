import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  BlockchainTxIrrecoverableError,
  CompensationAction,
} from '../errors/app-errors';

import {
  FailureRecordEntity,
  FailureRecordStatus,
} from './failure-record.entity';
import { FailureRecordService } from './failure-record.service';

const mockRepo = {
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
};

describe('FailureRecordService', () => {
  let service: FailureRecordService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FailureRecordService,
        {
          provide: getRepositoryToken(FailureRecordEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get(FailureRecordService);
  });

  describe('persist', () => {
    it('saves a failure record and returns it', async () => {
      const error = new BlockchainTxIrrecoverableError('tx failed', {
        jobId: 'j1',
      });
      const saved = { id: 'rec-1', status: FailureRecordStatus.PENDING_REVIEW };
      mockRepo.create.mockReturnValue(saved);
      mockRepo.save.mockResolvedValue(saved);

      const result = await service.persist({
        error,
        compensationsApplied: [CompensationAction.NOTIFY_ADMIN],
        compensationsFailed: [],
        correlationId: 'corr-1',
      });

      expect(result).toEqual(saved);
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'tx failed',
          compensationsApplied: [CompensationAction.NOTIFY_ADMIN],
          compensationsFailed: [],
          correlationId: 'corr-1',
          status: FailureRecordStatus.PENDING_REVIEW,
        }),
      );
    });

    it('returns null and does not throw when DB save fails', async () => {
      const error = new BlockchainTxIrrecoverableError('tx failed', {});
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.persist({
        error,
        compensationsApplied: [],
        compensationsFailed: [],
      });

      expect(result).toBeNull();
    });
  });

  describe('findPendingReview', () => {
    it('queries for PENDING_REVIEW records', async () => {
      mockRepo.find.mockResolvedValue([{ id: 'r1' }]);
      const result = await service.findPendingReview();
      expect(mockRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: FailureRecordStatus.PENDING_REVIEW },
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('markResolved', () => {
    it('updates status to resolved with notes', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });
      await service.markResolved('rec-1', 'manually fixed');
      expect(mockRepo.update).toHaveBeenCalledWith('rec-1', {
        status: FailureRecordStatus.RESOLVED,
        reviewNotes: 'manually fixed',
      });
    });
  });
});
