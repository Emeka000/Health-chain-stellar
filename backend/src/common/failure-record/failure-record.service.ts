import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { CompensationAction, IrrecoverableError } from '../errors/app-errors';

import {
  FailureRecordEntity,
  FailureRecordStatus,
} from './failure-record.entity';

export interface CreateFailureRecordInput {
  error: IrrecoverableError;
  compensationsApplied: CompensationAction[];
  compensationsFailed: CompensationAction[];
  correlationId?: string;
}

@Injectable()
export class FailureRecordService {
  private readonly logger = new Logger(FailureRecordService.name);

  constructor(
    @InjectRepository(FailureRecordEntity)
    private readonly repo: Repository<FailureRecordEntity>,
  ) {}

  /**
   * Persist an irrecoverable failure for audit trail and manual review.
   * This method must never throw — a failure here would mask the original error.
   */
  async persist(
    input: CreateFailureRecordInput,
  ): Promise<FailureRecordEntity | null> {
    try {
      const record = this.repo.create({
        message: input.error.message,
        domain: input.error.domain,
        compensationsApplied: input.compensationsApplied,
        compensationsFailed: input.compensationsFailed,
        context: input.error.context,
        stackTrace: input.error.stack ?? null,
        correlationId: input.correlationId ?? null,
        status: FailureRecordStatus.PENDING_REVIEW,
      });

      const saved = await this.repo.save(record);

      this.logger.warn(
        `[FailureRecord] Persisted irrecoverable failure: id=${saved.id} domain=${saved.domain}`,
        { failureRecordId: saved.id, context: input.error.context },
      );

      return saved;
    } catch (err) {
      // Log but never re-throw — this is a best-effort audit trail
      this.logger.error(
        '[FailureRecord] Could not persist failure record to DB',
        err instanceof Error ? err.stack : String(err),
      );
      return null;
    }
  }

  async findPendingReview(): Promise<FailureRecordEntity[]> {
    return this.repo.find({
      where: { status: FailureRecordStatus.PENDING_REVIEW },
      order: { createdAt: 'DESC' },
    });
  }

  async markResolved(id: string, reviewNotes: string): Promise<void> {
    await this.repo.update(id, {
      status: FailureRecordStatus.RESOLVED,
      reviewNotes,
    });
  }
}
