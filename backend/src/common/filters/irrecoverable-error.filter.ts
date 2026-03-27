import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { IrrecoverableError, RecoverableError } from '../errors/app-errors';

import type { Response } from 'express';

/**
 * Global filter that intercepts AppError subclasses and returns
 * structured, deterministic HTTP responses.
 *
 * Irrecoverable errors → 422 Unprocessable Entity with a reference ID.
 * Recoverable errors   → 503 Service Unavailable (safe to retry).
 */
@Catch(IrrecoverableError, RecoverableError)
export class AppErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppErrorFilter.name);

  catch(exception: IrrecoverableError | RecoverableError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof IrrecoverableError) {
      this.logger.error(
        `[IrrecoverableError] domain=${exception.domain} message=${exception.message}`,
        { context: exception.context, stack: exception.stack },
      );

      response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Irrecoverable Failure',
        message: exception.message,
        domain: exception.domain,
        // Surface the failure record ID if it was attached by the caller
        failureRecordId:
          (exception.context['failureRecordId'] as string) ?? null,
      });
    } else {
      this.logger.warn(`[RecoverableError] message=${exception.message}`, {
        context: exception.context,
      });

      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Transient Failure',
        message: exception.message,
        retryable: true,
      });
    }
  }
}
