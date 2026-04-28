import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import Redis from 'ioredis';

/**
 * Custom Redis health indicator.
 * Creates a short-lived connection, sends PING, and disconnects.
 * Returns 'down' if the connection or PING fails.
 */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly config: ConfigService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const client = new Redis({
      host: this.config.get<string>('REDIS_HOST', 'localhost'),
      port: this.config.get<number>('REDIS_PORT', 6379),
      password: this.config.get<string>('REDIS_PASSWORD'),
      connectTimeout: 2000,
      lazyConnect: true,
    });

    try {
      await client.connect();
      const pong = await client.ping();
      if (pong !== 'PONG') throw new Error('Unexpected PING response');
      return this.getStatus(key, true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HealthCheckError(
        'Redis check failed',
        // Return 'down' without leaking host/port
        this.getStatus(key, false, { message: 'down' }),
      );
    } finally {
      client.disconnect();
    }
  }
}
