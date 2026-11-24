import { Injectable, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type Redis from 'ioredis';

@Injectable()
export class IdempotencyService {
  private redis: Redis;
  private readonly IDEMPOTENCY_PREFIX = 'idempotency:';
  private readonly IDEMPOTENCY_TTL = 86400 * 7; // 7 days

  constructor(
    private configService: ConfigService,
    @Optional() @Inject('REDIS_CLIENT') redis?: Redis,
  ) {
    if (!redis) {
      throw new Error(
        'IdempotencyService requires the shared REDIS_CLIENT provider; ensure RedisModule is imported',
      );
    }
    this.redis = redis;
  }

  async checkAndSetIdempotencyKey(key: string): Promise<boolean> {
    const fullKey = `${this.IDEMPOTENCY_PREFIX}${key}`;
    const result = await this.redis.set(
      fullKey,
      '1',
      'EX',
      this.IDEMPOTENCY_TTL,
      'NX',
    );
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
