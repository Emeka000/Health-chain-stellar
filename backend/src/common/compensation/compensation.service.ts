import { Injectable, Logger } from '@nestjs/common';

import { CompensationAction, IrrecoverableError } from '../errors/app-errors';
import { FailureRecordService } from '../failure-record/failure-record.service';

export interface CompensationHandler {
  action: CompensationAction;
  /** Returns true on success, false if the compensation itself failed. */
  execute: () => Promise<boolean>;
}

export interface CompensationResult {
  applied: CompensationAction[];
  failed: CompensationAction[];
  failureRecordId: string | null;
}

/**
 * Orchestrates compensating actions for irrecoverable failures.
 *
 * Guarantees:
 * - All handlers are attempted even if earlier ones fail (no short-circuit).
 * - Results are persisted to the failure_records table for audit/manual review.
 * - This service never throws — callers always get a result.
 */
@Injectable()
export class CompensationService {
  private readonly logger = new Logger(CompensationService.name);

  constructor(private readonly failureRecordService: FailureRecordService) {}

  async compensate(
    error: IrrecoverableError,
    handlers: CompensationHandler[],
    correlationId?: string,
  ): Promise<CompensationResult> {
    this.logger.error(
      `[Compensation] Irrecoverable failure in domain=${error.domain}: ${error.message}`,
      { context: error.context, correlationId },
    );

    const applied: CompensationAction[] = [];
    const failed: CompensationAction[] = [];

    // Run all handlers — never short-circuit on individual failures
    for (const handler of handlers) {
      try {
        const success = await handler.execute();
        if (success) {
          applied.push(handler.action);
          this.logger.log(
            `[Compensation] Applied: ${handler.action} (domain=${error.domain})`,
          );
        } else {
          failed.push(handler.action);
          this.logger.warn(
            `[Compensation] Handler returned false: ${handler.action} (domain=${error.domain})`,
          );
        }
      } catch (handlerErr) {
        failed.push(handler.action);
        this.logger.error(
          `[Compensation] Handler threw for action=${handler.action} (domain=${error.domain})`,
          handlerErr instanceof Error ? handlerErr.stack : String(handlerErr),
        );
      }
    }

    // Always persist the failure record regardless of handler outcomes
    const record = await this.failureRecordService.persist({
      error,
      compensationsApplied: applied,
      compensationsFailed: failed,
      correlationId,
    });

    if (failed.length > 0) {
      this.logger.error(
        `[Compensation] ${failed.length} compensation(s) failed for domain=${error.domain}. Manual intervention required.`,
        { failureRecordId: record?.id, failed },
      );
    }

    return {
      applied,
      failed,
      failureRecordId: record?.id ?? null,
    };
  }
}
