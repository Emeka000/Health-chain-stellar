/**
 * Tests for #639: refresh token replay detection and concurrent device session handling.
 *
 * These are unit tests that mock Redis and the DB layer so they run without
 * infrastructure.  The key behaviours under test:
 *
 *  1. Replaying a refresh token triggers session family revocation and throws
 *     AUTH_REFRESH_TOKEN_REUSE.
 *  2. A valid (first-use) refresh token rotates successfully.
 *  3. Concurrent sessions from different devices are tracked and the oldest
 *     sessions are evicted when MAX_CONCURRENT_SESSIONS is exceeded.
 *  4. SessionRiskService flags device mismatch when two active sessions have
 *     different UA families.
 */

import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { SecurityEventLoggerService } from '../user-activity/security-event-logger.service';
import { UserActivityService } from '../user-activity/user-activity.service';
import { UserEntity } from '../users/entities/user.entity';

import { AuthService } from './auth.service';
import { AuthSessionRepository } from './repositories/auth-session.repository';
import { SessionRiskService } from './session-risk.service';
import { AuthSessionEntity } from './entities/auth-session.entity';
import { JwtKeyService } from './jwt-key.service';
import { MfaService } from './mfa/mfa.service';
import { hashPassword } from './utils/password.util';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'user-1',
    email: 'test@example.com',
    role: 'donor',
    passwordHash: '',
    failedLoginAttempts: 0,
    lockedUntil: null,
    emailVerified: true,
    passwordHistory: [],
    ...overrides,
  } as UserEntity;
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockJwtKeyService = {
  getActiveKey: jest.fn().mockReturnValue({ kid: 'k1', secret: 'secret' }),
  resolveSecret: jest.fn().mockReturnValue('secret'),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('signed-token'),
  verify: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, def?: unknown) => {
    const cfg: Record<string, unknown> = {
      JWT_SECRET: 'secret',
      JWT_REFRESH_SECRET: 'refresh-secret',
      JWT_EXPIRES_IN: '1h',
      JWT_REFRESH_EXPIRES_IN: '7d',
      MAX_FAILED_LOGIN_ATTEMPTS: 5,
      ACCOUNT_LOCK_MINUTES: 15,
      PASSWORD_HISTORY_LENGTH: 3,
      MAX_CONCURRENT_SESSIONS: 2,
    };
    return cfg[key] ?? def;
  }),
};

const mockRedis = {
  set: jest.fn(),
  hset: jest.fn(),
  expire: jest.fn(),
  zadd: jest.fn(),
  zrange: jest.fn().mockResolvedValue([]),
  zrevrange: jest.fn().mockResolvedValue([]),
  zrem: jest.fn(),
  del: jest.fn(),
  hgetall: jest.fn().mockResolvedValue({}),
};

const mockAuthSessionRepo = {
  create: jest.fn().mockResolvedValue({}),
  revokeSession: jest.fn().mockResolvedValue(undefined),
  revokeUserSessions: jest.fn().mockResolvedValue(undefined),
  updateLastActivity: jest.fn().mockResolvedValue(undefined),
};

const mockUserActivityService = {
  logActivity: jest.fn().mockResolvedValue({}),
};

const mockMfaService = {
  isMfaEnabled: jest.fn().mockResolvedValue(false),
  verifyMfaToken: jest.fn(),
};

const mockSessionRiskService = {
  scoreSession: jest.fn().mockResolvedValue({
    score: 0,
    level: 'low',
    signals: { geoVelocity: false, deviceMismatch: false, tokenAbuse: false },
    requiresStepUp: false,
  }),
};

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('AuthService – refresh token replay & concurrent sessions (#639)', () => {
  let service: AuthService;
  let userRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    userRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtKeyService, useValue: mockJwtKeyService },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: AuthSessionRepository, useValue: mockAuthSessionRepo },
        { provide: UserActivityService, useValue: mockUserActivityService },
        { provide: SecurityEventLoggerService, useFactory: () => new SecurityEventLoggerService(mockUserActivityService as any) },
        { provide: MfaService, useValue: mockMfaService },
        { provide: SessionRiskService, useValue: mockSessionRiskService },
      ],
    }).compile();

    service = module.get(AuthService);
    jest.clearAllMocks();
  });

  // ── 1. Refresh token replay ──────────────────────────────────────────────

  describe('refreshToken()', () => {
    const validPayload = {
      sub: 'user-1',
      email: 'test@example.com',
      role: 'donor',
      sid: 'session-abc',
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'jti-1',
    };

    it('rotates tokens on first use', async () => {
      mockJwtService.verify.mockReturnValue(validPayload);
      // NX set returns 'OK' → token not yet consumed
      mockRedis.set.mockResolvedValue('OK');
      // Session exists and is not revoked
      mockRedis.hgetall.mockResolvedValue({
        userId: 'user-1',
        email: 'test@example.com',
        role: 'donor',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      mockJwtService.sign.mockReturnValue('new-token');

      const result = await service.refreshToken('old-refresh-token');

      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(mockRedis.set).toHaveBeenCalledWith(
        expect.stringContaining('auth:refresh-consumed:'),
        '1',
        'EX',
        expect.any(Number),
        'NX',
      );
    });

    it('throws AUTH_REFRESH_TOKEN_REUSE on replay and revokes session family', async () => {
      mockJwtService.verify.mockReturnValue(validPayload);
      // NX set returns null → token already consumed (replay)
      mockRedis.set.mockResolvedValue(null);
      mockRedis.hgetall.mockResolvedValue({
        userId: 'user-1',
        email: 'test@example.com',
      });

      await expect(service.refreshToken('replayed-token')).rejects.toThrow(
        UnauthorizedException,
      );

      // Verify session was revoked in Redis
      expect(mockRedis.hset).toHaveBeenCalledWith(
        expect.stringContaining('auth:session:session-abc'),
        'revokedAt',
        expect.any(String),
        'revocationReason',
        expect.stringContaining('REFRESH_TOKEN_REUSE'),
      );

      // Verify DB revocation was attempted
      expect(mockAuthSessionRepo.revokeSession).toHaveBeenCalledWith(
        'session-abc',
        expect.stringContaining('REFRESH_TOKEN_REUSE'),
      );
    });

    it('throws AUTH_SESSION_REVOKED when session is already revoked', async () => {
      mockJwtService.verify.mockReturnValue(validPayload);
      mockRedis.set.mockResolvedValue('OK');
      // Session has revokedAt set
      mockRedis.hgetall.mockResolvedValue({
        userId: 'user-1',
        revokedAt: new Date().toISOString(),
      });

      await expect(service.refreshToken('token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws when JWT verification fails', async () => {
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await expect(service.refreshToken('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ── 2. Concurrent session limit ──────────────────────────────────────────

  describe('login() – concurrent session enforcement', () => {
    it('evicts oldest sessions when MAX_CONCURRENT_SESSIONS is exceeded', async () => {
      const user = makeUser();
      user.passwordHash = await hashPassword('Password1!');
      userRepo.findOne.mockResolvedValue(user);
      mockMfaService.isMfaEnabled.mockResolvedValue(false);
      mockJwtService.sign.mockReturnValue('token');

      // Simulate 3 existing sessions (limit is 2)
      mockRedis.zrange.mockResolvedValue(['sid-old-1', 'sid-old-2', 'sid-old-3']);
      mockRedis.hgetall.mockImplementation((key: string) => {
        if (key.includes('sid-old')) {
          return Promise.resolve({
            userId: 'user-1',
            email: 'test@example.com',
            role: 'donor',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          });
        }
        return Promise.resolve({});
      });

      await service.login({ email: 'test@example.com', password: 'Password1!' });

      // revokeSession should have been called for the excess sessions
      expect(mockRedis.hset).toHaveBeenCalledWith(
        expect.stringContaining('auth:session:'),
        'revokedAt',
        expect.any(String),
      );
    });
  });
});

// ─── SessionRiskService unit tests ────────────────────────────────────────────

describe('SessionRiskService – device mismatch & geo-velocity (#639)', () => {
  let riskService: SessionRiskService;
  let sessionRepo: { find: jest.Mock };

  beforeEach(async () => {
    sessionRepo = { find: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionRiskService,
        { provide: getRepositoryToken(AuthSessionEntity), useValue: sessionRepo },
      ],
    }).compile();

    riskService = module.get(SessionRiskService);
  });

  it('returns LOW risk with no other sessions', async () => {
    sessionRepo.find.mockResolvedValue([]);
    const result = await riskService.scoreSession('u1', 's1', {
      userAgent: 'Mozilla/5.0 Chrome/120',
      geoHint: '37.77,-122.41',
    });
    expect(result.level).toBe('low');
    expect(result.score).toBe(0);
    expect(result.requiresStepUp).toBe(false);
  });

  it('flags device mismatch when mobile and desktop sessions coexist', async () => {
    sessionRepo.find.mockResolvedValue([
      {
        sessionId: 's0',
        userAgent: 'Mozilla/5.0 Chrome/120 Desktop',
        geoHint: null,
        createdAt: new Date(),
        isActive: true,
      } as AuthSessionEntity,
    ]);

    const result = await riskService.scoreSession('u1', 's1', {
      userAgent: 'Mozilla/5.0 Android Mobile Safari',
      geoHint: null,
    });

    expect(result.signals.deviceMismatch).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(25);
  });

  it('flags geo-velocity for impossible travel', async () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000);
    sessionRepo.find.mockResolvedValue([
      {
        sessionId: 's0',
        userAgent: 'Chrome',
        // London
        geoHint: '51.50,-0.12',
        createdAt: oneHourAgo,
        isActive: true,
      } as AuthSessionEntity,
    ]);

    const result = await riskService.scoreSession('u1', 's1', {
      userAgent: 'Chrome',
      // New York — ~5,500 km away, 1 hour later → ~5500 km/h > 900 km/h threshold
      geoHint: '40.71,-74.00',
      createdAt: new Date(),
    });

    expect(result.signals.geoVelocity).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(50);
    expect(result.requiresStepUp).toBe(true);
  });

  it('does NOT flag geo-velocity for plausible travel', async () => {
    const tenHoursAgo = new Date(Date.now() - 10 * 3_600_000);
    sessionRepo.find.mockResolvedValue([
      {
        sessionId: 's0',
        userAgent: 'Chrome',
        geoHint: '51.50,-0.12', // London
        createdAt: tenHoursAgo,
        isActive: true,
      } as AuthSessionEntity,
    ]);

    const result = await riskService.scoreSession('u1', 's1', {
      userAgent: 'Chrome',
      geoHint: '48.85,2.35', // Paris — ~340 km, 10 hours → ~34 km/h
      createdAt: new Date(),
    });

    expect(result.signals.geoVelocity).toBe(false);
  });

  it('flags token abuse when refreshAbuseCount >= 3', async () => {
    sessionRepo.find.mockResolvedValue([]);
    const result = await riskService.scoreSession('u1', 's1', {}, 3);
    expect(result.signals.tokenAbuse).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(40);
  });

  it('returns CRITICAL level when multiple signals fire', async () => {
    const oneHourAgo = new Date(Date.now() - 3_600_000);
    sessionRepo.find.mockResolvedValue([
      {
        sessionId: 's0',
        userAgent: 'Mozilla/5.0 Chrome Desktop',
        geoHint: '51.50,-0.12',
        createdAt: oneHourAgo,
        isActive: true,
      } as AuthSessionEntity,
    ]);

    const result = await riskService.scoreSession(
      'u1', 's1',
      {
        userAgent: 'Mozilla/5.0 Android Mobile',
        geoHint: '40.71,-74.00',
        createdAt: new Date(),
      },
      3, // token abuse
    );

    expect(result.level).toBe('critical');
    expect(result.score).toBe(100);
    expect(result.requiresStepUp).toBe(true);
  });
});
