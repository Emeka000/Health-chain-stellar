/**
 * FeeCorrectionListener — unit tests
 *
 * Validates that approval workflow events correctly transition
 * fee correction runs between statuses.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { FeeCorrectionRunEntity } from './entities/fee-correction-run.entity';
import { FeeCorrectionListener } from './fee-correction.listener';
import { FeeCorrectionRunStatus } from './enums/fee-correction.enum';

const makeRun = (overrides: Partial<FeeCorrectionRunEntity> = {}): FeeCorrectionRunEntity =>
  Object.assign(new FeeCorrectionRunEntity(), {
    id: 'run-1',
    approvalRequestId: 'approval-req-1',
    status: FeeCorrectionRunStatus.PENDING_APPROVAL,
    ...overrides,
  });

describe('FeeCorrectionListener', () => {
  let listener: FeeCorrectionListener;
  let runRepo: { findOne: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    runRepo = {
      findOne: jest.fn().mockResolvedValue(makeRun()),
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeCorrectionListener,
        { provide: getRepositoryToken(FeeCorrectionRunEntity), useValue: runRepo },
      ],
    }).compile();

    listener = module.get<FeeCorrectionListener>(FeeCorrectionListener);
  });

  describe('handleApprovalApproved', () => {
    it('transitions run to APPROVED when actionType is FEE_OVERRIDE', async () => {
      await listener.handleApprovalApproved({
        requestId: 'approval-req-1',
        targetId: 'key-001',
        actionType: 'FEE_OVERRIDE',
      });

      expect(runRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: FeeCorrectionRunStatus.APPROVED }),
      );
    });

    it('ignores events with non-FEE_OVERRIDE actionType', async () => {
      await listener.handleApprovalApproved({
        requestId: 'approval-req-1',
        targetId: 'key-001',
        actionType: 'DISPUTE_RESOLUTION',
      });

      expect(runRepo.save).not.toHaveBeenCalled();
    });

    it('does nothing when no run is found for the approval request', async () => {
      runRepo.findOne.mockResolvedValue(null);

      await listener.handleApprovalApproved({
        requestId: 'unknown-req',
        targetId: 'key-001',
        actionType: 'FEE_OVERRIDE',
      });

      expect(runRepo.save).not.toHaveBeenCalled();
    });

    it('does not re-transition a run that is already APPROVED', async () => {
      runRepo.findOne.mockResolvedValue(
        makeRun({ status: FeeCorrectionRunStatus.APPROVED }),
      );

      await listener.handleApprovalApproved({
        requestId: 'approval-req-1',
        targetId: 'key-001',
        actionType: 'FEE_OVERRIDE',
      });

      expect(runRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('handleApprovalRejected', () => {
    it('transitions run to REJECTED when actionType is FEE_OVERRIDE', async () => {
      await listener.handleApprovalRejected({
        requestId: 'approval-req-1',
        actionType: 'FEE_OVERRIDE',
      });

      expect(runRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: FeeCorrectionRunStatus.REJECTED }),
      );
    });

    it('ignores events with non-FEE_OVERRIDE actionType', async () => {
      await listener.handleApprovalRejected({
        requestId: 'approval-req-1',
        actionType: 'ESCROW_RELEASE',
      });

      expect(runRepo.save).not.toHaveBeenCalled();
    });

    it('does nothing when no run is found', async () => {
      runRepo.findOne.mockResolvedValue(null);

      await listener.handleApprovalRejected({
        requestId: 'unknown-req',
        actionType: 'FEE_OVERRIDE',
      });

      expect(runRepo.save).not.toHaveBeenCalled();
    });
  });
});
