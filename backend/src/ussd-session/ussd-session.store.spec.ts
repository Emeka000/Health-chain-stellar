/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';

import {
  UssdSessionStore,
  REDIS_CLIENT,
  USSD_SESSION_TTL_SECONDS,
  MAX_FALLBACK_SESSIONS,
} from './ussd-session.store';
import { UssdSession, UssdStep } from './ussd.types';

describe('UssdSessionStore', () => {
  let store: UssdSessionStore;
  let redisMock: {
    get: jest.Mock;
    setex: jest.Mock;
    del: jest.Mock;
  };

  const mockSession: UssdSession = {
    sessionId: 'sess-001',
    phoneNumber: '+2348012345678',
    step: UssdStep.LOGIN_PHONE,
    sessionNonce: 'nonce-1',
    sequenceNumber: 0,
    history: [],
    lastRequestFingerprint: null,
    lastRequestDepth: null,
    lastResponse: null,
    lastProcessedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
    expiresAt: Date.now() + 1000 * USSD_SESSION_TTL_SECONDS,
  };

  beforeEach(async () => {
    redisMock = {
      get: jest.fn(),
      setex: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UssdSessionStore,
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    store = module.get<UssdSessionStore>(UssdSessionStore);
  });

  describe('get()', () => {
    it('returns parsed session when key exists', async () => {
      redisMock.get.mockResolvedValue(JSON.stringify(mockSession));
      const result = await store.get('sess-001');
      expect(result).toMatchObject({
        sessionId: 'sess-001',
        step: UssdStep.LOGIN_PHONE,
      });
      expect(redisMock.get).toHaveBeenCalledWith('ussd:session:sess-001');
    });

    it('returns null when key does not exist', async () => {
      redisMock.get.mockResolvedValue(null);
      const result = await store.get('missing');
      expect(result).toBeNull();
    });

    it('returns null on Redis error without throwing', async () => {
      redisMock.get.mockRejectedValue(new Error('Redis down'));
      const result = await store.get('sess-001');
      expect(result).toBeNull();
    });
  });

  describe('set()', () => {
    it('persists session with correct TTL', async () => {
      const session = { ...mockSession };
      await store.set(session);
      expect(redisMock.setex).toHaveBeenCalledWith(
        'ussd:session:sess-001',
        USSD_SESSION_TTL_SECONDS,
        expect.any(String),
      );
      const stored = JSON.parse(redisMock.setex.mock.calls[0][2]);
      expect(stored.sessionId).toBe('sess-001');
    });

    it('updates updatedAt timestamp on set', async () => {
      const before = Date.now();
      const session = { ...mockSession, updatedAt: 0 };
      await store.set(session);
      const stored = JSON.parse(
        redisMock.setex.mock.calls[0][2],
      ) as UssdSession;
      expect(stored.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('falls back to memory when Redis fails', async () => {
      redisMock.setex.mockRejectedValue(new Error('Redis error'));
      await expect(store.set({ ...mockSession })).resolves.toBeUndefined();

      redisMock.get.mockRejectedValue(new Error('Redis error'));
      const result = await store.get('sess-001');
      expect(result).toMatchObject({
        sessionId: 'sess-001',
        step: UssdStep.LOGIN_PHONE,
      });
    });
  });

  describe('delete()', () => {
    it('calls del with correct key', async () => {
      await store.delete('sess-001');
      expect(redisMock.del).toHaveBeenCalledWith('ussd:session:sess-001');
    });

    it('does not throw on Redis del error', async () => {
      redisMock.del.mockRejectedValue(new Error('Redis error'));
      await expect(store.delete('sess-001')).resolves.toBeUndefined();
    });
  });

  describe('createInitial()', () => {
    it('creates a new session at LOGIN_PHONE step', async () => {
      const session = await store.createInitial('sess-new', '+2348099999999');
      expect(session.step).toBe(UssdStep.LOGIN_PHONE);
      expect(session.history).toHaveLength(0);
      expect(session.phoneNumber).toBe('+2348099999999');
      expect(session.sequenceNumber).toBe(0);
      expect(session.sessionNonce).toBeDefined();
      expect(redisMock.setex).toHaveBeenCalled();
    });
  });

  describe('in-memory fallback', () => {
    const fallbackMap = (s: UssdSessionStore) =>
      (s as unknown as { fallbackSessions: Map<string, UssdSession> })
        .fallbackSessions;

    it('does not keep a copy of abandoned sessions while Redis is healthy', async () => {
      for (let i = 0; i < 50; i++) {
        await store.set({ ...mockSession, sessionId: `healthy-${i}` });
      }
      expect(fallbackMap(store).size).toBe(0);
    });

    it('drops a stale fallback copy once a Redis write succeeds', async () => {
      redisMock.setex.mockRejectedValueOnce(new Error('Redis error'));
      await store.set({ ...mockSession });
      expect(fallbackMap(store).size).toBe(1);

      await store.set({ ...mockSession });
      expect(fallbackMap(store).size).toBe(0);
    });

    it('bounds the fallback map while Redis is down', async () => {
      redisMock.setex.mockRejectedValue(new Error('Redis error'));
      const total = MAX_FALLBACK_SESSIONS + 100;
      for (let i = 0; i < total; i++) {
        await store.set({ ...mockSession, sessionId: `down-${i}` });
      }
      const map = fallbackMap(store);
      expect(map.size).toBe(MAX_FALLBACK_SESSIONS);
      expect(map.has('down-0')).toBe(false);
      expect(map.has(`down-${total - 1}`)).toBe(true);
    });

    it('removes expired fallback entries when they are read', async () => {
      redisMock.setex.mockRejectedValueOnce(new Error('Redis error'));
      await store.set({ ...mockSession, sessionId: 'expired', expiresAt: 1 });
      expect(fallbackMap(store).size).toBe(1);

      redisMock.get.mockResolvedValue(null);
      await expect(store.get('expired')).resolves.toBeNull();
      expect(fallbackMap(store).size).toBe(0);
    });

    it('prunes expired fallback entries on the next fallback write', async () => {
      redisMock.setex.mockRejectedValue(new Error('Redis error'));
      await store.set({ ...mockSession, sessionId: 'old', expiresAt: 1 });
      await store.set({ ...mockSession, sessionId: 'fresh' });

      const map = fallbackMap(store);
      expect(map.has('old')).toBe(false);
      expect(map.has('fresh')).toBe(true);
    });

    it('clears the fallback copy on delete', async () => {
      redisMock.setex.mockRejectedValueOnce(new Error('Redis error'));
      await store.set({ ...mockSession });
      await store.delete('sess-001');
      expect(fallbackMap(store).size).toBe(0);
    });
  });
});
