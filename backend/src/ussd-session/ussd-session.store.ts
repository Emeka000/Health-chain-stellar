import { Injectable, Inject, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { UssdSession, UssdStep } from './ussd.types';
import { REDIS_CLIENT } from '../redis/redis.constants';

export { REDIS_CLIENT } from '../redis/redis.constants';
export const USSD_SESSION_TTL_SECONDS = 120; // Africa's Talking default session timeout

@Injectable()
export class UssdSessionStore {
  private readonly logger = new Logger(UssdSessionStore.name);
  private readonly KEY_PREFIX = 'ussd:session:';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private buildKey(sessionId: string): string {
    return `${this.KEY_PREFIX}${sessionId}`;
  }

  async get(sessionId: string): Promise<UssdSession | null> {
    try {
      const data = await this.redis.get(this.buildKey(sessionId));
      return data ? (JSON.parse(data) as UssdSession) : null;
    } catch (err) {
      this.logger.error(`Failed to get USSD session ${sessionId}`, err);
      return null;
    }
  }

  async set(session: UssdSession): Promise<void> {
    try {
      session.updatedAt = Date.now();
      await this.redis.setex(
        this.buildKey(session.sessionId),
        USSD_SESSION_TTL_SECONDS,
        JSON.stringify(session),
      );
    } catch (err) {
      this.logger.error(`Failed to set USSD session ${session.sessionId}`, err);
      throw err;
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      await this.redis.del(this.buildKey(sessionId));
    } catch (err) {
      this.logger.error(`Failed to delete USSD session ${sessionId}`, err);
    }
  }

  async createInitial(sessionId: string, phoneNumber: string): Promise<UssdSession> {
    const session: UssdSession = {
      sessionId,
      phoneNumber,
      step: UssdStep.LOGIN_PHONE,
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await this.set(session);
    return session;
  }
}
