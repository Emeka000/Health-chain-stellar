import { Injectable, Logger } from '@nestjs/common';

import Redis from 'ioredis';

/**
 * Circuit breaker for Redis operations.
 * Provides graceful degradation when Redis is unavailable.
 */
@Injectable()
export class RedisCircuitBreaker {
  private readonly logger = new Logger(RedisCircuitBreaker.name);
  private isOpen = false;
  private failureCount = 0;
  private lastFailureTime: number | null = null;

  private readonly failureThreshold = 5;
  private readonly resetTimeoutMs = 30_000; // 30 seconds

  async execute<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T> | T,
  ): Promise<T> {
    if (this.isOpen) {
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime > this.resetTimeoutMs
      ) {
        this.logger.log('Circuit breaker: attempting to reset');
        this.isOpen = false;
        this.failureCount = 0;
        this.lastFailureTime = null;
      } else {
        this.logger.warn('Circuit breaker: open, using fallback');
        return fallback();
      }
    }

    try {
      const result = await operation();
      if (this.failureCount > 0) {
        this.logger.log('Circuit breaker: operation succeeded, resetting');
        this.failureCount = 0;
        this.lastFailureTime = null;
      }
      return result;
    } catch (error) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      this.logger.error(
        `Circuit breaker: operation failed (${this.failureCount}/${this.failureThreshold}): ${error.message}`,
      );

      if (this.failureCount >= this.failureThreshold) {
        this.isOpen = true;
        this.logger.error('Circuit breaker: opening circuit');
      }

      return fallback();
    }
  }

  isCircuitOpen(): boolean {
    return this.isOpen;
  }
}
