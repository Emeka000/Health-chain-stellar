import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger as WinstonLogger } from 'winston';

import { ErrorCode } from '../errors/error-codes.enum';

import type { Request, Response } from 'express';

/**
 * Global exception filter that maps all thrown errors to a consistent
 * response schema:
 * {
 *   statusCode, code, message, traceId, timestamp, path
 * }
 *
 * HttpExceptions are mapped directly; unknown errors become 500.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  constructor(
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly winstonLogger: WinstonLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const traceId = request.correlationId ?? 'unknown';
    const path = request.url;

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        // Try to parse JSON-encoded error bodies (used in auth service)
        try {
          const parsed = JSON.parse(body) as { code?: string; message?: string };
          code = parsed.code ?? this.statusToCode(statusCode);
          message = parsed.message ?? body;
        } catch {
          code = this.statusToCode(statusCode);
          message = body;
        }
      } else if (typeof body === 'object' && body !== null) {
        const bodyObj = body as Record<string, unknown>;
        code = (bodyObj['code'] as string) ?? this.statusToCode(statusCode);
        message =
          Array.isArray(bodyObj['message'])
            ? (bodyObj['message'] as string[]).join(', ')
            : (bodyObj['message'] as string) ?? message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.winstonLogger.error('Unhandled exception', {
        traceId,
        path,
        error: exception.message,
        stack: exception.stack,
      });
    }

    const body = {
      statusCode,
      code,
      message,
      traceId,
      timestamp: new Date().toISOString(),
      path,
    };

    this.winstonLogger.warn('HTTP error response', { ...body });

    response.status(statusCode).json(body);
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: ErrorCode.VALIDATION_FAILED,
      401: ErrorCode.AUTH_UNAUTHORIZED,
      403: ErrorCode.AUTH_FORBIDDEN,
      404: ErrorCode.RESOURCE_NOT_FOUND,
      409: ErrorCode.RESOURCE_CONFLICT,
      429: ErrorCode.RATE_LIMIT_EXCEEDED,
      503: ErrorCode.SERVICE_UNAVAILABLE,
    };
    return map[status] ?? ErrorCode.INTERNAL_SERVER_ERROR;
  }
}
