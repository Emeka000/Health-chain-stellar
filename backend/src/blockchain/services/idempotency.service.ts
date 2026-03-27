import { Injectable, Inject, Optional } from '@nestjs/common';

import type { RedisClientType } from 'redis';

@Injectable()
export class IdempotencyService {
  private redis: RedisClientType;
  private readonly IDEMPOTENCY_PREFIX = 'idempotency:';
  private readonly IDEMPOTENCY_TTL = 86400 * 7; // 7 days

  constructor(@Optional() @Inject('REDIS_CLIENT') redis?: RedisClientType) {
    if (redis) {
      this.redis = redis;
    } else {
      // Lazy load Redis only if not provided (for testing)
      const { createClient } = require('redis');
      this.redis = createClient({
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        },
      });
    }
  }

  async checkAndSetIdempotencyKey(key: string): Promise<boolean> {
    const fullKey = `${this.IDEMPOTENCY_PREFIX}${key}`;
    const result = await this.redis.set(fullKey, '1', {
      EX: this.IDEMPOTENCY_TTL,
      NX: true,
    });
    return result === 'OK';
  }

  async getIdempotencyKey(key: string): Promise<boolean> {
    const fullKey = `${this.IDEMPOTENCY_PREFIX}${key}`;
    const exists = await this.redis.exists(fullKey);
    return exists === 1;
  }

  async clearIdempotencyKey(key: string): Promise<void> {
    const fullKey = `${this.IDEMPOTENCY_PREFIX}${key}`;
    await this.redis.del(fullKey);
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
