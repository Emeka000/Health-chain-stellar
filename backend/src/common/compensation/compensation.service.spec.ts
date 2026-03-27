import { Test, TestingModule } from '@nestjs/testing';

import {
  BlockchainTxIrrecoverableError,
  CompensationAction,
} from '../errors/app-errors';
import { FailureRecordService } from '../failure-record/failure-record.service';

import { CompensationService } from './compensation.service';

const mockFailureRecordService = {
  persist: jest.fn().mockResolvedValue({ id: 'record-uuid' }),
};

describe('CompensationService', () => {
  let service: CompensationService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompensationService,
        { provide: FailureRecordService, useValue: mockFailureRecordService },
      ],
    }).compile();

    service = module.get(CompensationService);
  });

  it('runs all handlers and returns applied list', async () => {
    const error = new BlockchainTxIrrecoverableError('tx failed', {
      jobId: '1',
    });
    const handlers = [
      {
        action: CompensationAction.NOTIFY_ADMIN,
        execute: jest.fn().mockResolvedValue(true),
      },
      {
        action: CompensationAction.FLAG_FOR_REVIEW,
        execute: jest.fn().mockResolvedValue(true),
      },
    ];

    const result = await service.compensate(error, handlers, 'corr-1');

    expect(result.applied).toEqual([
      CompensationAction.NOTIFY_ADMIN,
      CompensationAction.FLAG_FOR_REVIEW,
    ]);
    expect(result.failed).toHaveLength(0);
    expect(result.failureRecordId).toBe('record-uuid');
    expect(mockFailureRecordService.persist).toHaveBeenCalledTimes(1);
  });

  it('records failed handlers without short-circuiting', async () => {
    const error = new BlockchainTxIrrecoverableError('tx failed', {
      jobId: '2',
    });
    const handlers = [
      {
        action: CompensationAction.REVERT_INVENTORY,
        execute: jest.fn().mockRejectedValue(new Error('db down')),
      },
      {
        action: CompensationAction.NOTIFY_ADMIN,
        execute: jest.fn().mockResolvedValue(true),
      },
    ];

    const result = await service.compensate(error, handlers);

    // Second handler must still run even though first threw
    expect(handlers[1].execute).toHaveBeenCalled();
    expect(result.failed).toContain(CompensationAction.REVERT_INVENTORY);
    expect(result.applied).toContain(CompensationAction.NOTIFY_ADMIN);
  });

  it('records handler that returns false as failed', async () => {
    const error = new BlockchainTxIrrecoverableError('tx failed', {
      jobId: '3',
    });
    const handlers = [
      {
        action: CompensationAction.NOTIFY_USER,
        execute: jest.fn().mockResolvedValue(false),
      },
    ];

    const result = await service.compensate(error, handlers);

    expect(result.failed).toContain(CompensationAction.NOTIFY_USER);
    expect(result.applied).toHaveLength(0);
  });

  it('still persists failure record even when all handlers fail', async () => {
    const error = new BlockchainTxIrrecoverableError('tx failed', {
      jobId: '4',
    });
    const handlers = [
      {
        action: CompensationAction.REVERT_INVENTORY,
        execute: jest.fn().mockRejectedValue(new Error('boom')),
      },
    ];

    await service.compensate(error, handlers);

    expect(mockFailureRecordService.persist).toHaveBeenCalledTimes(1);
  });

  it('returns null failureRecordId when persist fails', async () => {
    mockFailureRecordService.persist.mockResolvedValueOnce(null);
    const error = new BlockchainTxIrrecoverableError('tx failed', {
      jobId: '5',
    });

    const result = await service.compensate(error, []);

    expect(result.failureRecordId).toBeNull();
  });
});
