import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ApprovalStatus } from '../approvals/enums/approval.enum';
import { FeeCorrectionRunEntity } from './entities/fee-correction-run.entity';
import { FeeCorrectionRunStatus } from './enums/fee-correction.enum';

/**
 * Listens for approval workflow events and transitions fee correction runs
 * from PENDING_APPROVAL → APPROVED or REJECTED accordingly.
 *
 * The event payload emitted by ApprovalService is:
 *   { requestId, targetId, actionType, status }
 */
@Injectable()
export class FeeCorrectionListener {
  private readonly logger = new Logger(FeeCorrectionListener.name);

  constructor(
    @InjectRepository(FeeCorrectionRunEntity)
    private readonly runRepo: Repository<FeeCorrectionRunEntity>,
  ) {}

  @OnEvent('approval.approved')
  async handleApprovalApproved(payload: {
    requestId: string;
    targetId: string;
    actionType: string;
  }): Promise<void> {
    if (payload.actionType !== 'FEE_OVERRIDE') return;

    const run = await this.runRepo.findOne({
      where: { approvalRequestId: payload.requestId },
    });

    if (!run) {
      this.logger.warn(
        `No fee correction run found for approval request ${payload.requestId}`,
      );
      return;
    }

    if (run.status !== FeeCorrectionRunStatus.PENDING_APPROVAL) {
      this.logger.warn(
        `Run ${run.id} is already in status ${run.status}; skipping approval transition`,
      );
      return;
    }

    run.status = FeeCorrectionRunStatus.APPROVED;
    await this.runRepo.save(run);
    this.logger.log(`Fee correction run ${run.id} approved via approval request ${payload.requestId}`);
  }

  @OnEvent('approval.rejected')
  async handleApprovalRejected(payload: {
    requestId: string;
    actionType: string;
  }): Promise<void> {
    if (payload.actionType !== 'FEE_OVERRIDE') return;

    const run = await this.runRepo.findOne({
      where: { approvalRequestId: payload.requestId },
    });

    if (!run) return;

    if (run.status !== FeeCorrectionRunStatus.PENDING_APPROVAL) return;

    run.status = FeeCorrectionRunStatus.REJECTED;
    await this.runRepo.save(run);
    this.logger.log(`Fee correction run ${run.id} rejected via approval request ${payload.requestId}`);
  }
}
