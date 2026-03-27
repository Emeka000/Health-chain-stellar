import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';

import { Request, Response } from 'express';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

import { ErrorCode } from '../errors/error-codes.enum';

import { IdempotencyService } from './idempotency.service';

/**
 * Idempotency interceptor for POST endpoints.
 * Ensures duplicate requests return the same result without duplicate writes.
 * Requires Idempotency-Key header.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly idempotencyService: IdempotencyService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Only apply to POST requests
    if (request.method !== 'POST') {
      return next.handle();
    }

    const idempotencyKey = request.headers['idempotency-key'] as string;

    // Idempotency-Key is optional but recommended
    if (!idempotencyKey) {
      return next.handle();
    }

    // Validate idempotency key format
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0) {
      throw new BadRequestException(
        JSON.stringify({
          code: ErrorCode.IDEMPOTENCY_KEY_MISSING,
          message: 'Invalid Idempotency-Key header',
        }),
      );
    }

    // Check for cached response
    const cachedResponse =
      await this.idempotencyService.getResponse(idempotencyKey);
    if (cachedResponse) {
      this.logger.debug(
        `Returning cached response for idempotency key: ${idempotencyKey}`,
      );
      response.status(cachedResponse.statusCode);
      return of(cachedResponse.body);
    }

    // Try to acquire lock to prevent concurrent processing
    const lockAcquired =
      await this.idempotencyService.acquireLock(idempotencyKey);
    if (!lockAcquired) {
      throw new ConflictException(
        JSON.stringify({
          code: ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
          message:
            'Request with this Idempotency-Key is already being processed',
        }),
      );
    }

    try {
      return next.handle().pipe(
        tap(async (data) => {
          // Store response for future retries
          const statusCode = response.statusCode || 200;
          await this.idempotencyService.storeResponse(
            idempotencyKey,
            statusCode,
            data,
          );
        }),
      );
    } finally {
      // Release lock after processing
      await this.idempotencyService.releaseLock(idempotencyKey);
    }
  }
}
