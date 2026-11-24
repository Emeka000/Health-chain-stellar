import { Module, Global, OnModuleDestroy, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const logger = new Logger('RedisModule');
        const client = new Redis(REDIS_URL, {
          maxRetriesPerRequest: 3,
          lazyConnect: false,
        });
        client.on('error', (err) => logger.error(`Redis error: ${err.message}`));
        client.on('connect', () => logger.log('Redis connected'));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
