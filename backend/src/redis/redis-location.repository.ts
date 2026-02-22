
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisLocationRepository {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async updateLocation(riderId: string, lat: number, lng: number) {
    const key = `rider:${riderId}:location`;
    await this.redis.set(key, JSON.stringify({ lat, lng }), 'EX', 600); // 600s = 10min
  }

  async getLocation(riderId: string): Promise<{ lat: number; lng: number } | null> {
    const data = await this.redis.get(`rider:${riderId}:location`);
    return data ? JSON.parse(data) : null;
  }
}