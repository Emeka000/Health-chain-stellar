import { randomUUID } from 'crypto';

import { Injectable, Inject, Logger } from '@nestjs/common';

import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../redis/redis.constants';

import { UssdSession, UssdStep } from './ussd.types';

export { REDIS_CLIENT } from '../redis/redis.constants';
export const USSD_SESSION_TTL_SECONDS = 120; // Africa's Talking default session timeout
export const MAX_FALLBACK_SESSIONS = 1000; // Upper bound for the in-memory fallback map

@Injectable()
export class UssdSessionStore {
  private readonly logger = new Logger(UssdSessionStore.name);
  private readonly KEY_PREFIX = 'ussd:session:';
  // Only populated while Redis is unavailable. Insertion order is used to evict the oldest entry.
  private readonly fallbackSessions = new Map<string, UssdSession>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private buildKey(sessionId: string): string {
    return `${this.KEY_PREFIX}${sessionId}`;
  }

  private writeFallback(session: UssdSession): void {
    const now = Date.now();
    this.fallbackSessions.delete(session.sessionId);

    for (const [id, entry] of this.fallbackSessions) {
      if (this.isExpired(entry, now)) {
        this.fallbackSessions.delete(id);
      }
    }

    for (const id of this.fallbackSessions.keys()) {
      if (this.fallbackSessions.size < MAX_FALLBACK_SESSIONS) {
        break;
      }
      this.fallbackSessions.delete(id);
    }

    this.fallbackSessions.set(session.sessionId, this.cloneSession(session));
  }

  private getFallback(sessionId: string): UssdSession | null {
    const fallback = this.fallbackSessions.get(sessionId);
    if (!fallback) {
      return null;
    }
    if (this.isExpired(fallback)) {
      this.fallbackSessions.delete(sessionId);
      return null;
    }
    return this.cloneSession(fallback);
  }

  private cloneSession(session: UssdSession): UssdSession {
    return {
      ...session,
      history: [...session.history],
      lastResponse: session.lastResponse ? { ...session.lastResponse } : null,
    };
  }

  private normalizeSession(session: UssdSession): UssdSession {
    const now = Date.now();
    return {
      ...session,
      history: [...session.history],
      sessionNonce: session.sessionNonce || randomUUID(),
      sequenceNumber: session.sequenceNumber ?? session.history.length,
      lastRequestFingerprint: session.lastRequestFingerprint ?? null,
      lastRequestDepth: session.lastRequestDepth ?? null,
      lastResponse: session.lastResponse ?? null,
      lastProcessedAt: session.lastProcessedAt ?? null,
      createdAt: session.createdAt ?? now,
      updatedAt: now,
      expiresAt: session.expiresAt ?? now + USSD_SESSION_TTL_SECONDS * 1000,
    };
  }

  private isExpired(session: UssdSession, now = Date.now()): boolean {
    return session.expiresAt <= now;
  }

  async get(sessionId: string): Promise<UssdSession | null> {
    try {
      const data = await this.redis.get(this.buildKey(sessionId));
      if (data) {
        const session = this.normalizeSession(JSON.parse(data) as UssdSession);
        if (this.isExpired(session)) {
          return null;
        }
        return this.cloneSession(session);
      }
    } catch (err) {
      this.logger.error(`Failed to get USSD session ${sessionId}`, err);
    }

    return this.getFallback(sessionId);
  }

  async set(session: UssdSession): Promise<void> {
    try {
      const normalized = this.normalizeSession(session);
      Object.assign(session, normalized);
      await this.redis.setex(
        this.buildKey(session.sessionId),
        USSD_SESSION_TTL_SECONDS,
        JSON.stringify(normalized),
      );
      // Redis is the source of truth again, so drop any stale copy from an outage.
      this.fallbackSessions.delete(session.sessionId);
    } catch (err) {
      this.logger.error(`Failed to set USSD session ${session.sessionId}`, err);
      this.writeFallback(session);
    }
  }

  async delete(sessionId: string): Promise<void> {
    try {
      await this.redis.del(this.buildKey(sessionId));
    } catch (err) {
      this.logger.error(`Failed to delete USSD session ${sessionId}`, err);
    }
    this.fallbackSessions.delete(sessionId);
  }

  async createInitial(
    sessionId: string,
    phoneNumber: string,
  ): Promise<UssdSession> {
    const now = Date.now();
    const session: UssdSession = {
      sessionId,
      phoneNumber,
      step: UssdStep.LOGIN_PHONE,
      sessionNonce: randomUUID(),
      sequenceNumber: 0,
      history: [],
      lastRequestFingerprint: null,
      lastRequestDepth: null,
      lastResponse: null,
      lastProcessedAt: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + USSD_SESSION_TTL_SECONDS * 1000,
    };
    await this.set(session);
    return session;
  }
}
