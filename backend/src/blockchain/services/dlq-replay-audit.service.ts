import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import {
  DlqReplayAuditEntity,
  DlqReplayOutcome,
} from '../entities/dlq-replay-audit.entity';

export interface ReplayAuditInput {
  actorId: string;
  reason: string;
  jobsAttempted: number;
  jobsReplayed: number;
  jobsFailed: number;
  errorDetails?: string;
}

@Injectable()
export class DlqReplayAuditService {
  private readonly logger = new Logger(DlqReplayAuditService.name);

  constructor(
    @InjectRepository(DlqReplayAuditEntity)
    private readonly repo: Repository<DlqReplayAuditEntity>,
  ) {}

  async record(input: ReplayAuditInput): Promise<DlqReplayAuditEntity> {
    const outcome =
      input.jobsFailed === 0
        ? DlqReplayOutcome.SUCCESS
        : input.jobsReplayed > 0
          ? DlqReplayOutcome.PARTIAL
          : DlqReplayOutcome.FAILED;

    const audit = this.repo.create({
      actorId: input.actorId,
      reason: input.reason,
      jobsAttempted: input.jobsAttempted,
      jobsReplayed: input.jobsReplayed,
      jobsFailed: input.jobsFailed,
      outcome,
      errorDetails: input.errorDetails ?? null,
    });

    const saved = await this.repo.save(audit);
    this.logger.log(
      `[DLQ Audit] actor=${input.actorId} attempted=${input.jobsAttempted} ` +
        `replayed=${input.jobsReplayed} failed=${input.jobsFailed} outcome=${outcome}`,
    );
    return saved;
  }

  async findAll(): Promise<DlqReplayAuditEntity[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }
}
