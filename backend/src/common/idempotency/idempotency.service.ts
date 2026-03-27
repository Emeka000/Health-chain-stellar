import { Injectable, Inject, Logger } from '@nestjs/common';

import Redis from 'ioredis';

import { ErrorCode } from '../common/errors/error-codes.enum';

import { REDIS_CLIENT } from './redis.constants';

/**
 * Idempotency service for handling duplicate requests.
 * Stores request results keyed by Idempotency-Key header.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly ttlSeconds = 24 * 60 * 60; // 24 hours

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Get cached response for an idempotency key.
   * Returns null if not found or expired.
   */
  async getResponse(
    idempotencyKey: string,
  ): Promise<{ statusCode: number; body: unknown } | null> {
    try {
      const cached = await this.redis.get(this.getKey(idempotencyKey));
      if (!cached) {
        return null;
      }
      return JSON.parse(cached);
    } catch (error) {
      this.logger.error(
        `Failed to retrieve idempotency response: ${error.message}`,
      );
      return null;
    }
  }

  /**
   * Store response for an idempotency key.
   * Prevents duplicate writes on retry.
   */
  async storeResponse(
    idempotencyKey: string,
    statusCode: number,
    body: unknown,
  ): Promise<void> {
    try {
      const key = this.getKey(idempotencyKey);
      const value = JSON.stringify({ statusCode, body });
      await this.redis.setex(key, this.ttlSeconds, value);
    } catch (error) {
      this.logger.error(
        `Failed to store idempotency response: ${error.message}`,
      );
    }
  }

  /**
   * Check if idempotency key is already being processed.
   * Returns true if already processing, false if we can proceed.
   */
  async acquireLock(idempotencyKey: string): Promise<boolean> {
    try {
      const key = this.getLockKey(idempotencyKey);
      const result = await this.redis.set(
        key,
        '1',
        'EX',
        30, // 30 second lock timeout
        'NX',
      );
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Failed to acquire idempotency lock: ${error.message}`);
      return true; // Allow request to proceed on error
    }
  }

  /**
   * Release the processing lock.
   */
  async releaseLock(idempotencyKey: string): Promise<void> {
    try {
      await this.redis.del(this.getLockKey(idempotencyKey));
    } catch (error) {
      this.logger.error(`Failed to release idempotency lock: ${error.message}`);
    }
  }

  private getKey(idempotencyKey: string): string {
    return `idempotency:response:${idempotencyKey}`;
  }

  private getLockKey(idempotencyKey: string): string {
    return `idempotency:lock:${idempotencyKey}`;
  }
}
