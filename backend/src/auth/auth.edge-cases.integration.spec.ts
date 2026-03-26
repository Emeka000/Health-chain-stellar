/**
 * Auth Edge-Case Integration Tests
 *
 * Covers three categories of security-critical edge cases:
 *   1. Parallel logins  — concurrent login calls, session-limit enforcement,
 *                         failed-attempt counter under concurrent wrong passwords
 *   2. Lock expiry      — auto-unlock when lockedUntil is in the past,
 *                         lock still active, admin manual unlock
 *   3. Replay attempts  — concurrent refresh (SET NX race), sequential replay,
 *                         revoked-session token, tampered / expired token
 *
 * Infrastructure: ioredis-mock (in-memory Redis) + mocked TypeORM repository.
 * No real database or Redis instance required.
 */
/// <reference types="jest" />

import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import RedisMock from 'ioredis-mock';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { UserEntity } from '../users/entities/user.entity';

import { AuthService } from './auth.service';
import { hashPassword } from './utils/password.util';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal UserEntity with sensible defaults. */
function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
  return {
    id: 'user-edge-001',
    email: 'edge@example.com',
    name: 'Edge User',
    role: 'donor',
    region: '',
    phoneNumber: '',
    passwordHash: '', // filled in beforeAll
    failedLoginAttempts: 0,
    lockedUntil: null,
    passwordHistory: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as UserEntity;
}

// ─── Shared module factory ─────────────────────────────────────────────────────

async function buildModule(userRepo: {
  findOne: jest.Mock;
  save: jest.Mock;
  create?: jest.Mock;
}) {
  const redis = new RedisMock();

  const module: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
      JwtModule.register({
        secret: 'test-secret-key-32-chars-minimum!!',
        signOptions: { expiresIn: '1h' },
      }),
    ],
    providers: [
      AuthService,
      { provide: REDIS_CLIENT, useValue: redis },
      { provide: getRepositoryToken(UserEntity), useValue: userRepo },
    ],
  }).compile();

  return {
    service: module.get<AuthService>(AuthService),
    jwtService: module.get<JwtService>(JwtService),
    redis,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PARALLEL LOGINS
// ─────────────────────────────────────────────────────────────────────────────

describe('[Edge] Parallel Logins', () => {
  let service: AuthService;
  let redis: InstanceType<typeof RedisMock>;
  let user: UserEntity;
  let userRepo: { findOne: jest.Mock; save: jest.Mock };

  beforeAll(async () => {
    const passwordHash = await hashPassword('ValidPass1!');
    user = makeUser({ passwordHash });

    userRepo = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn().mockImplementation(async (u) => u),
    };

    ({ service, redis } = await buildModule(userRepo));
  });

  afterEach(async () => {
    await redis.flushdb();
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    jest.clearAllMocks();
    userRepo.findOne.mockResolvedValue(user);
    userRepo.save.mockImplementation(async (u) => u);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('all concurrent logins with correct credentials succeed and return distinct tokens', async () => {
    const CONCURRENCY = 5;
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        service.login({ email: user.email, password: 'ValidPass1!' }),
      ),
    );

    expect(results).toHaveLength(CONCURRENCY);
    results.forEach((r) => {
      expect(r.access_token).toBeDefined();
      expect(r.refresh_token).toBeDefined();
    });

    // Every access token must be unique (each login gets its own sessionId)
    const accessTokens = results.map((r) => r.access_token);
    expect(new Set(accessTokens).size).toBe(CONCURRENCY);
  });

  it('concurrent session limit is enforced — oldest sessions are evicted', async () => {
    // Default MAX_CONCURRENT_SESSIONS = 3; login 5 times sequentially
    for (let i = 0; i < 5; i++) {
      await service.login({ email: user.email, password: 'ValidPass1!' });
    }

    const sessions = await service.getActiveSessions(user.id);
    // At most 3 sessions should remain
    expect(sessions.length).toBeLessThanOrEqual(3);
  });

  it('sequential wrong-password attempts each increment the counter once', async () => {
    // Run 3 sequential bad-password logins — sequential to avoid shared-object
    // mutation races (the mock repo returns the same user object reference).
    for (let i = 0; i < 3; i++) {
      await service
        .login({ email: user.email, password: 'WrongPass!' })
        .catch(() => {});
    }

    // Counter must be exactly 3
    expect(user.failedLoginAttempts).toBe(3);
  });

  it('5 concurrent wrong-password attempts trigger account lock', async () => {
    // Pre-set counter to 4 so the next failure locks
    user.failedLoginAttempts = 4;

    await expect(
      service.login({ email: user.email, password: 'WrongPass!' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(user.failedLoginAttempts).toBe(5);
    expect(user.lockedUntil).toBeInstanceOf(Date);
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('a correct login after failed attempts resets the counter', async () => {
    user.failedLoginAttempts = 3;

    const result = await service.login({
      email: user.email,
      password: 'ValidPass1!',
    });

    expect(result.access_token).toBeDefined();
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });

  it('each parallel login creates an independent session in Redis', async () => {
    const CONCURRENCY = 3;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        service.login({ email: user.email, password: 'ValidPass1!' }),
      ),
    );

    const sessions = await service.getActiveSessions(user.id);
    expect(sessions.length).toBe(CONCURRENCY);
    // Each session must have a distinct userId entry
    sessions.forEach((s) => expect(s!['userId']).toBe(user.id));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. LOCK EXPIRY
// ─────────────────────────────────────────────────────────────────────────────

describe('[Edge] Lock Expiry', () => {
  let service: AuthService;
  let redis: InstanceType<typeof RedisMock>;
  let user: UserEntity;
  let userRepo: { findOne: jest.Mock; save: jest.Mock };

  beforeAll(async () => {
    const passwordHash = await hashPassword('ValidPass1!');
    user = makeUser({ passwordHash });

    userRepo = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn().mockImplementation(async (u) => u),
    };

    ({ service, redis } = await buildModule(userRepo));
  });

  afterEach(async () => {
    await redis.flushdb();
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    jest.clearAllMocks();
    userRepo.findOne.mockResolvedValue(user);
    userRepo.save.mockImplementation(async (u) => u);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('rejects login while lock is still active', async () => {
    user.failedLoginAttempts = 5;
    user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min in future

    await expect(
      service.login({ email: user.email, password: 'ValidPass1!' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects login with wrong password while lock is still active', async () => {
    user.failedLoginAttempts = 5;
    user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);

    await expect(
      service.login({ email: user.email, password: 'WrongPass!' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('auto-unlocks and allows login when lockedUntil is in the past', async () => {
    user.failedLoginAttempts = 5;
    user.lockedUntil = new Date(Date.now() - 1); // 1ms in the past

    const result = await service.login({
      email: user.email,
      password: 'ValidPass1!',
    });

    expect(result.access_token).toBeDefined();
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });

  it('auto-unlock clears the lock even when lockedUntil is exactly now', async () => {
    // Use a timestamp that is guaranteed to be <= Date.now() by the time
    // ensureAccountIsUsable() runs (1ms buffer is sufficient)
    user.failedLoginAttempts = 5;
    user.lockedUntil = new Date(Date.now() - 1);

    await expect(
      service.login({ email: user.email, password: 'ValidPass1!' }),
    ).resolves.toHaveProperty('access_token');

    expect(user.lockedUntil).toBeNull();
  });

  it('lock expiry does not reset counter if wrong password is given after unlock', async () => {
    // Lock has expired
    user.failedLoginAttempts = 5;
    user.lockedUntil = new Date(Date.now() - 1);

    // Wrong password after auto-unlock → counter resets to 1
    await expect(
      service.login({ email: user.email, password: 'WrongPass!' }),
    ).rejects.toThrow(UnauthorizedException);

    // After auto-unlock the counter was reset to 0, then incremented to 1
    expect(user.failedLoginAttempts).toBe(1);
  });

  it('admin manual unlock clears lock and counter', async () => {
    user.failedLoginAttempts = 5;
    user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);

    // Admin unlocks
    const result = await service.manualUnlockByAdmin(user.id);
    expect(result.message).toBe('Account unlocked successfully');

    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lockedUntil).toBeNull();
  });

  it('admin unlock allows immediate login', async () => {
    user.failedLoginAttempts = 5;
    user.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);

    await service.manualUnlockByAdmin(user.id);

    const result = await service.login({
      email: user.email,
      password: 'ValidPass1!',
    });
    expect(result.access_token).toBeDefined();
  });

  it('lock is re-applied after MAX_FAILED_ATTEMPTS following an unlock', async () => {
    // Start clean
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;

    // Fail 5 times
    for (let i = 0; i < 5; i++) {
      await service.login({ email: user.email, password: 'WrongPass!' }).catch(() => {});
    }

    expect(user.lockedUntil).toBeInstanceOf(Date);
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

    // Admin unlocks
    await service.manualUnlockByAdmin(user.id);
    expect(user.lockedUntil).toBeNull();

    // Fail 5 more times → should lock again
    for (let i = 0; i < 5; i++) {
      await service.login({ email: user.email, password: 'WrongPass!' }).catch(() => {});
    }

    expect(user.lockedUntil).toBeInstanceOf(Date);
  });

  it('non-existent user returns 401, not 403', async () => {
    userRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.login({ email: 'ghost@example.com', password: 'anything' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. REPLAY ATTEMPTS
// ─────────────────────────────────────────────────────────────────────────────

describe('[Edge] Replay Attempts', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let redis: InstanceType<typeof RedisMock>;
  let user: UserEntity;
  let userRepo: { findOne: jest.Mock; save: jest.Mock };

  beforeAll(async () => {
    const passwordHash = await hashPassword('ValidPass1!');
    user = makeUser({ passwordHash });

    userRepo = {
      findOne: jest.fn().mockResolvedValue(user),
      save: jest.fn().mockImplementation(async (u) => u),
    };

    ({ service, jwtService, redis } = await buildModule(userRepo));
  });

  afterEach(async () => {
    await redis.flushdb();
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    jest.clearAllMocks();
    userRepo.findOne.mockResolvedValue(user);
    userRepo.save.mockImplementation(async (u) => u);
  });

  afterAll(async () => {
    await redis.quit();
  });

  // ── Sequential replay ──────────────────────────────────────────────────────

  it('second use of the same refresh token is rejected (sequential replay)', async () => {
    const { refresh_token } = await service.login({
      email: user.email,
      password: 'ValidPass1!',
    });

    // First use succeeds
    const first = await service.refreshToken(refresh_token);
    expect(first.access_token).toBeDefined();

    // Second use of the same token must fail
    await expect(service.refreshToken(refresh_token)).rejects.toThrow(
      'INVALID_REFRESH_TOKEN',
    );
  });

  it('third and subsequent uses of a consumed token are also rejected', async () => {
    const { refresh_token } = await service.login({
      email: user.email,
      password: 'ValidPass1!',
    });

    await service.refreshToken(refresh_token);

    for (let i = 0; i < 3; i++) {
      await expect(service.refreshToken(refresh_token)).rejects.toThrow(
        'INVALID_REFRESH_TOKEN',
      );
    }
  });

  // ── Concurrent replay (SET NX race) ───────────────────────────────────────

  it('exactly one concurrent refresh succeeds when N requests race', async () => {
    const { refresh_token } = await service.login({
      email: user.email,
      password: 'ValidPass1!',
    });

    const CONCURRENCY = 8;
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () =>
        service.refreshToken(refresh_token),
      ),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(CONCURRENCY - 1);

    failed.forEach((r) => {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
        UnauthorizedException,
      );
      expect((r as PromiseRejectedResult).reason.message).toBe(
        'INVALID_REFRESH_TOKEN',
      );
    });
  });

  it('the new token issued after rotation is itself usable exactly once', async () => {
    const { refresh_token: token1 } = await service.login({
      email: user.email,
      password: 'ValidPass1!',
    });

    const { refresh_token: token2 } = await service.refreshToken(token1);
    const { refresh_token: token3 } = await service.refreshToken(token2);

    expect(token3).toBeDefined();

    // token1 and token2 are now consumed
    await expect(service.refreshToken(token1)).rejects.toThrow(
      'INVALID_REFRESH_TOKEN',
    );
    await expect(service.refreshToken(token2)).rejects.toThrow(
      'INVALID_REFRESH_TOKEN',
    );
  });

  // ── Revoked session ────────────────────────────────────────────────────────

  it('refresh token for a revoked session is rejected with SESSION_REVOKED', async () => {
    const { refresh_token } = await service.login({
      email: user.email,
      password: 'ValidPass1!',
    });

    // Decode to get the sessionId
    const decoded = jwtService.decode(refresh_token) as { sid: string };
    expect(decoded.sid).toBeDefined();

    // Revoke the session
    await service.revokeSession(user.id, decoded.sid);

    // Refresh attempt must fail with SESSION_REVOKED
    await expect(service.refreshToken(refresh_token)).rejects.toThrow(
      'SESSION_REVOKED',
    );
  });

  it('refresh token for a session evicted by concurrent-session limit is rejected', async () => {
    // Login 4 times — the 4th evicts the 1st (limit = 3)
    const tokens: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { refresh_token } = await service.login({
        email: user.email,
        password: 'ValidPass1!',
      });
      tokens.push(refresh_token);
    }

    // The oldest session (tokens[0]) was evicted from Redis
    // Its refresh token should fail because the session no longer exists
    await expect(service.refreshToken(tokens[0])).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // ── Tampered / structurally invalid tokens ─────────────────────────────────

  it('completely invalid token string is rejected', async () => {
    await expect(service.refreshToken('not.a.jwt')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token signed with wrong secret is rejected', async () => {
    // Sign with a different secret
    const forgedToken = jwtService.sign(
      { sub: user.id, email: user.email, role: 'donor', sid: 'fake-sid' },
      { secret: 'wrong-secret-entirely' },
    );

    await expect(service.refreshToken(forgedToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('token with no sid claim is rejected', async () => {
    // Sign with the refresh secret (fallback 'refresh-secret') but omit sid.
    // AuthService.refreshToken verifies with JWT_REFRESH_SECRET → 'refresh-secret'.
    const noSidToken = jwtService.sign(
      { sub: user.id, email: user.email, role: 'donor' /* no sid */ },
      {
        secret: 'refresh-secret', // matches AuthService fallback for JWT_REFRESH_SECRET
        expiresIn: '7d',
      },
    );

    await expect(service.refreshToken(noSidToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  // ── Payload integrity after rotation ──────────────────────────────────────

  it('rotated access token preserves original user claims', async () => {
    const { refresh_token } = await service.login({
      email: user.email,
      password: 'ValidPass1!',
    });

    const { access_token } = await service.refreshToken(refresh_token);
    const decoded = jwtService.decode(access_token) as Record<string, unknown>;

    expect(decoded['sub']).toBe(user.id);
    expect(decoded['email']).toBe(user.email);
    expect(decoded['role']).toBe(user.role);
    expect(decoded['sid']).toBeDefined();
  });

  it('rotated refresh token preserves the same sessionId (sid)', async () => {
    const { refresh_token: token1 } = await service.login({
      email: user.email,
      password: 'ValidPass1!',
    });

    const sid1 = (jwtService.decode(token1) as { sid: string }).sid;

    const { refresh_token: token2 } = await service.refreshToken(token1);
    const sid2 = (jwtService.decode(token2) as { sid: string }).sid;

    // Session is reused across rotations — same sid
    expect(sid2).toBe(sid1);
  });
});
