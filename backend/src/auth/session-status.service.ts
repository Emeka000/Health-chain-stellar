import { Inject, Injectable, Logger } from '@nestjs/common';

import Redis from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.constants';

import { AuthSessionRepository } from './repositories/auth-session.repository';

/**
 * Answers "is this session still valid?" for access-token consumers
 * (JwtStrategy, WsAuthService). Redis `auth:session:<sid>` is the cached
 * source of truth written by AuthService; the auth_sessions table is used
 * only when Redis is unavailable. Fails closed.
 */
@Injectable()
export class SessionStatusService {
  private readonly logger = new Logger(SessionStatusService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly authSessionRepository: AuthSessionRepository,
  ) {}

  async isSessionActive(sessionId: string | undefined): Promise<boolean> {
    if (!sessionId) return false;

    try {
      const session = await this.redis.hgetall(`auth:session:${sessionId}`);
      if (Object.keys(session).length === 0) return false;
      return !session.revokedAt;
    } catch (err: unknown) {
      this.logger.warn(
        `Redis session lookup failed, falling back to DB: ${(err as Error).message}`,
      );
    }

    try {
      // findBySessionId only returns active (non-revoked) sessions
      const session =
        await this.authSessionRepository.findBySessionId(sessionId);
      return !!session && !session.revokedAt;
    } catch (err: unknown) {
      this.logger.error(`DB session lookup failed: ${(err as Error).message}`);
      return false;
    }
  }
}
