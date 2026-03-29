import { createHash, randomBytes } from 'crypto';

import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  Inject,
  Logger,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';

import Redis from 'ioredis';
import { Repository } from 'typeorm';

import { ErrorCode } from '../common/errors/error-codes.enum';
import { AuthSessionFallbackStore } from '../redis/auth-session-fallback.store';
import { RedisCircuitBreaker } from '../redis/redis-circuit-breaker';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SecurityEventLoggerService, SecurityEventType } from '../user-activity/security-event-logger.service';
import { UserActivityService } from '../user-activity/user-activity.service';
import { UserEntity } from '../users/entities/user.entity';
import { TwoFactorAuthEntity } from '../users/entities/two-factor-auth.entity';

import { JwtKeyService } from './jwt-key.service';
import { JwtPayload } from './jwt.strategy';
import { AuthSessionRepository } from './repositories/auth-session.repository';
import { validatePasswordStrength } from './utils/password-strength.util';
import {
  hashPassword,
  verifyPassword,
  dummyVerify,
} from './utils/password.util';
import { MfaService } from './mfa/mfa.service';

export interface SessionMetadata {
  ipAddress?: string | null;
  userAgent?: string | null;
  geoHint?: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly circuitBreaker: RedisCircuitBreaker;
  private readonly fallbackStore: AuthSessionFallbackStore;
  private readonly maxFailedLoginAttempts: number;
  private readonly accountLockMinutes: number;
  private readonly passwordHistoryLength: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly jwtKeyService: JwtKeyService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly authSessionRepository: AuthSessionRepository,
    private readonly userActivityService: UserActivityService,
    private readonly securityEventLogger: SecurityEventLoggerService,
    private readonly mfaService: MfaService,
  ) {
    this.circuitBreaker = new RedisCircuitBreaker();
    this.fallbackStore = new AuthSessionFallbackStore();
    this.maxFailedLoginAttempts = this.configService.get<number>('MAX_FAILED_LOGIN_ATTEMPTS', 5);
    this.accountLockMinutes = this.configService.get<number>('ACCOUNT_LOCK_MINUTES', 15);
    this.passwordHistoryLength = this.configService.get<number>('PASSWORD_HISTORY_LENGTH', 3);
  }

  async validateUser(
    email: string,
    password: string,
  ): Promise<UserEntity | null> {
    const user = await this.userRepository.findOne({
      where: { email: email.toLowerCase() },
    });

    if (!user?.passwordHash) {
      return null;
    }

    const valid = await verifyPassword(password, user.passwordHash);
    return valid ? user : null;
  }

  async login(loginDto: { email: string; password: string; role?: string }, meta: SessionMetadata = {}) {
    const user = await this.userRepository.findOne({
      where: { email: loginDto.email.toLowerCase() },
    });
    if (!user || !user.passwordHash) {
      await this.securityEventLogger
        .logEvent({
          eventType: SecurityEventType.AUTH_LOGIN_FAILED,
          userId: user?.id ?? null,
          email: loginDto.email.toLowerCase(),
          description: 'User login failed: user not found or no password',
          metadata: { reason: 'AUTH_INVALID_CREDENTIALS' },
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
        })
        .catch(() => undefined);
      await dummyVerify(loginDto.password);
      throw new UnauthorizedException(
        JSON.stringify({
          code: ErrorCode.AUTH_INVALID_CREDENTIALS,
          message: 'Invalid email or password',
        }),
      );
    }

    await this.ensureAccountIsUsable(user);

    const passwordValid = await verifyPassword(
      loginDto.password,
      user.passwordHash,
    );
    if (!passwordValid) {
      await this.recordFailedLoginAttempt(user);
      await this.securityEventLogger
        .logEvent({
          eventType: SecurityEventType.AUTH_LOGIN_FAILED,
          userId: user.id,
          email: user.email,
          description: 'User login failed: invalid credentials',
          metadata: { reason: 'AUTH_INVALID_CREDENTIALS' },
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
        })
        .catch(() => undefined);
      throw new UnauthorizedException(
        JSON.stringify({
          code: ErrorCode.AUTH_INVALID_CREDENTIALS,
          message: 'Invalid email or password',
        }),
      );
    }

    await this.resetLoginAttempts(user);

    // If MFA is enabled, return a challenge instead of full tokens
    const mfaEnabled = await this.mfaService.isMfaEnabled(user.id);
    if (mfaEnabled) {
      return { mfa_required: true, user_id: user.id };
    }

    const sessionId = randomBytes(16).toString('hex');
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role ?? loginDto.role ?? 'donor',
      sid: sessionId,
    };

    const { accessToken, refreshToken, refreshExpiresInSeconds } =
      this.issueTokens(payload);
    await this.createSession(user, sessionId, refreshExpiresInSeconds);
    await this.enforceConcurrentSessionLimit(user.id);

    await this.securityEventLogger.logEvent({
      eventType: SecurityEventType.AUTH_LOGIN_SUCCESS,
      userId: user.id,
      email: user.email,
      sessionId,
      description: 'User login succeeded',
      metadata: { role: payload.role },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  /**
   * Exchange a valid MFA token (issued by MfaService) for a full access + refresh token pair.
   */
  async exchangeMfaToken(mfaToken: string, meta: SessionMetadata = {}) {
    const userId = this.mfaService.verifyMfaToken(mfaToken);

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException(
        JSON.stringify({ code: ErrorCode.AUTH_INVALID_CREDENTIALS, message: 'User not found' }),
      );
    }

    const sessionId = randomBytes(16).toString('hex');
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      sid: sessionId,
    };

    const { accessToken, refreshToken, refreshExpiresInSeconds } =
      this.issueTokens(payload);
    await this.createSession(user, sessionId, refreshExpiresInSeconds, meta);
    await this.enforceConcurrentSessionLimit(user.id);

    await this.securityEventLogger.logEvent({
      eventType: SecurityEventType.AUTH_LOGIN_SUCCESS,
      userId: user.id,
      email: user.email,
      sessionId,
      description: 'User login succeeded via MFA',
      metadata: { role: payload.role, mfa: true },
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined);

    return { access_token: accessToken, refresh_token: refreshToken };
  }

  async register(registerDto: {
    email: string;
    password: string;
    role?: string;
    name?: string;
  }) {
    const strengthCheck = validatePasswordStrength(registerDto.password);
    if (!strengthCheck.valid) {
      throw new BadRequestException(
        JSON.stringify({
          code: ErrorCode.AUTH_WEAK_PASSWORD,
          message: strengthCheck.message,
        }),
      );
    }

    const email = registerDto.email.toLowerCase();
    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException(
        JSON.stringify({
          code: ErrorCode.AUTH_EMAIL_ALREADY_REGISTERED,
          message: 'Email already registered',
        }),
      );
    }

    const passwordHash = await hashPassword(registerDto.password);
    const requireVerification = this.configService.get<boolean>(
      'REQUIRE_EMAIL_VERIFICATION',
      false,
    );
    const user = this.userRepository.create({
      email,
      name: registerDto.name,
      role: registerDto.role ?? 'donor',
      passwordHash,
      passwordHistory: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
      emailVerified: !requireVerification,
    });
    const savedUser = await this.userRepository.save(user);

    return {
      message: 'Registration successful',
      user: {
        id: savedUser.id,
        email: savedUser.email,
        role: savedUser.role,
        name: savedUser.name,
      },
    };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<JwtPayload & { jti?: string }>(
        refreshToken,
        {
          secret: this.configService.get<string>(
            'JWT_REFRESH_SECRET',
            'refresh-secret',
          ),
        },
      );

      if (!payload.sid) {
        throw new UnauthorizedException(
          JSON.stringify({
            code: ErrorCode.AUTH_INVALID_REFRESH_TOKEN,
            message: 'Invalid refresh token',
          }),
        );
      }

      // Hash the raw token so the raw value is never stored as a Redis key.
      const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
      const tokenKey = `auth:refresh-consumed:${tokenHash}`;
      const expiresAt = payload.exp
        ? payload.exp - Math.floor(Date.now() / 1000)
        : this.getRefreshTokenExpirySeconds();
      const ttl = Math.max(expiresAt, 0);

      const consumed = await this.circuitBreaker.execute(
        async () => {
          const result = await this.redis.set(
            tokenKey,
            '1',
            'EX',
            ttl || 604800,
            'NX',
          );
          return result;
        },
        async () => {
          return (await this.fallbackStore.markTokenConsumed(tokenKey))
            ? 'OK'
            : null;
        },
      );

      if (!consumed) {
        await this.revokeSessionFamily(payload.sub, payload.sid, payload.email);
        throw new UnauthorizedException(
          JSON.stringify({
            code: ErrorCode.AUTH_REFRESH_TOKEN_REUSE,
            message:
              'Token reuse detected. All sessions have been revoked for your security.',
          }),
        );
      }

      const existingSession = await this.getSessionById(payload.sid);
      if (!existingSession || existingSession.revokedAt) {
        throw new UnauthorizedException(
          JSON.stringify({
            code: ErrorCode.AUTH_SESSION_REVOKED,
            message: 'Session has been revoked',
          }),
        );
      }

      this.logger.log(
        `Refresh token consumed for user ${payload.email}. Rotating tokens.`,
      );

      const newPayload: JwtPayload = {
        sub: payload.sub,
        email: payload.email,
        role: payload.role,
        sid: payload.sid,
      };

      const {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        refreshExpiresInSeconds,
      } = this.issueTokens(newPayload);
      await this.touchSession(
        payload.sub,
        payload.sid,
        refreshExpiresInSeconds,
      );

      return {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
      };
    } catch (error: unknown) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      let errorMessage: string = 'Unknown error';
      if (error instanceof Error) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        errorMessage = error.message ?? 'Unknown error';
      }
      this.logger.error(`Refresh token failed: ${errorMessage}`);
      throw new UnauthorizedException(
        JSON.stringify({
          code: ErrorCode.AUTH_INVALID_REFRESH_TOKEN,
          message: 'Invalid or expired refresh token',
        }),
      );
    }
  }

  private issueTokens(payload: JwtPayload): {
    accessToken: string;
    refreshToken: string;
    refreshExpiresInSeconds: number;
  } {
    const accessToken = this.jwtService.sign(
      payload as unknown as Record<string, unknown>,
      { secret, keyid: kid },
    );
    const refreshToken = this.generateRefreshToken(payload);
    return {
      accessToken,
      refreshToken,
      refreshExpiresInSeconds: this.getRefreshTokenExpirySeconds(),
    };
  }

  private generateRefreshToken(payload: JwtPayload): string {
    const jti = randomBytes(16).toString('hex');
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    return this.jwtService.sign(
      { ...payload, jti } as unknown as Record<string, unknown>,
      {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ??
          'refresh-secret',
        expiresIn: refreshExpiresIn,
      },
    );
  }

  async logout(userId: string, sessionId?: string) {
    if (sessionId) {
      await this.revokeSession(userId, sessionId);
      return { message: 'Logged out successfully' };
    }

    const sessionIds = await this.redis.zrange(
      this.userSessionsKey(userId),
      0,
      -1,
    );
    await Promise.all(sessionIds.map((sid) => this.revokeSession(userId, sid)));
    return { message: 'Logged out successfully' };
  }

  async getActiveSessions(userId: string) {
    const sessionIds = await this.redis.zrevrange(
      this.userSessionsKey(userId),
      0,
      -1,
    );
    const sessions = await Promise.all(
      sessionIds.map((sid) => this.getSessionById(sid)),
    );
    return sessions.filter((session) => session && !session.revokedAt);
  }

  /**
   * Revokes all Redis session state and DB record for a session family.
   * Called when a refresh token replay is detected — the entire session is
   * considered compromised regardless of which token in the family was reused.
   */
  private async revokeSessionFamily(
    userId: string,
    sessionId: string,
    email: string,
  ): Promise<void> {
    const auditReason = JSON.stringify({
      event: 'REFRESH_TOKEN_REUSE',
      detectedAt: new Date().toISOString(),
      email,
    });

    this.logger.warn(
      `Token family compromise detected for user ${email} (session ${sessionId}). Revoking session.`,
    );

    await this.securityEventLogger
      .logEvent({
        eventType: SecurityEventType.AUTH_REFRESH_TOKEN_REPLAY,
        userId,
        email,
        sessionId,
        description: 'Refresh token replay detected, revoking session family',
        metadata: { reason: 'REFRESH_TOKEN_REUSE' },
      })
      .catch(() => undefined);

    // Revoke in Redis
    await this.circuitBreaker.execute(
      async () => {
        await this.redis.hset(
          this.sessionKey(sessionId),
          'revokedAt',
          new Date().toISOString(),
          'revocationReason',
          auditReason,
        );
        await this.redis.zrem(this.userSessionsKey(userId), sessionId);
      },
      async () => {
        await this.fallbackStore.revokeSession(sessionId);
      },
    );

    // Persist audit log entry to DB
    try {
      await this.authSessionRepository.revokeSession(sessionId, auditReason);
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to persist family revocation audit log: ${(err as Error).message}`,
      );
    }
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.getSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(
        JSON.stringify({
          code: ErrorCode.AUTH_SESSION_NOT_FOUND,
          message: 'Session not found',
        }),
      );
    }
    if (session.userId !== userId) {
      throw new ForbiddenException(
        JSON.stringify({
          code: ErrorCode.AUTH_FORBIDDEN,
          message: 'Cannot revoke a session that is not yours',
        }),
      );
    }

    await this.redis.hset(
      this.sessionKey(sessionId),
      'revokedAt',
      new Date().toISOString(),
    );
    await this.redis.zrem(this.userSessionsKey(userId), sessionId);

    await this.securityEventLogger
      .logEvent({
        eventType: SecurityEventType.AUTH_SESSION_REVOKED,
        userId,
        sessionId,
        description: 'User session revoked',
        metadata: { reason: 'USER_REQUESTED' },
      })
      .catch(() => undefined);

    // Persist revocation to database
    try {
      await this.authSessionRepository.revokeSession(sessionId, 'User logout');
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to persist session revocation to database: ${(error as Error).message}`,
      );
    }

    return { message: 'Session revoked successfully' };
  }

  async manualUnlockByAdmin(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(
        JSON.stringify({
          code: ErrorCode.USER_NOT_FOUND,
          message: 'User not found',
        }),
      );
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await this.userRepository.save(user);

    await this.securityEventLogger
      .logEvent({
        eventType: SecurityEventType.AUTH_ACCOUNT_MANUALLY_UNLOCKED,
        userId: user.id,
        email: user.email,
        description: `Account manually unlocked by admin for ${user.email}`,
        metadata: { email: user.email, unlockedBy: 'admin' },
      })
      .catch((err: unknown) =>
        this.logger.warn(
          `Failed to log manual unlock event: ${(err as Error).message}`,
        ),
      );

    return { message: 'Account unlocked successfully' };
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ) {
    if (oldPassword === newPassword) {
      throw new BadRequestException(
        JSON.stringify({
          code: ErrorCode.AUTH_PASSWORD_SAME_AS_OLD,
          message: 'New password must be different from old password',
        }),
      );
    }

    const strengthCheck = validatePasswordStrength(newPassword);
    if (!strengthCheck.valid) {
      throw new BadRequestException(
        JSON.stringify({
          code: ErrorCode.AUTH_WEAK_PASSWORD,
          message: strengthCheck.message,
        }),
      );
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.passwordHash) {
      throw new NotFoundException(
        JSON.stringify({
          code: ErrorCode.USER_NOT_FOUND,
          message: 'User not found',
        }),
      );
    }

    const oldPasswordValid = await verifyPassword(
      oldPassword,
      user.passwordHash,
    );
    if (!oldPasswordValid) {
      throw new UnauthorizedException(
        JSON.stringify({
          code: ErrorCode.AUTH_OLD_PASSWORD_INCORRECT,
          message: 'Old password is incorrect',
        }),
      );
    }

    const recentHashes = [
      user.passwordHash,
      ...(user.passwordHistory ?? []),
    ].slice(0, this.passwordHistoryLength);
    for (const hash of recentHashes) {
      if (await verifyPassword(newPassword, hash)) {
        throw new BadRequestException(
          JSON.stringify({
            code: ErrorCode.AUTH_PASSWORD_REUSE,
            message: `Cannot reuse any of your last ${this.passwordHistoryLength} passwords`,
          }),
        );
      }
    }

    const newHash = await hashPassword(newPassword);
    user.passwordHistory = [
      user.passwordHash,
      ...(user.passwordHistory ?? []),
    ].slice(0, this.passwordHistoryLength);
    user.passwordHash = newHash;
    await this.userRepository.save(user);

    return { message: 'Password changed successfully' };
  }

  private async ensureAccountIsUsable(user: UserEntity) {
    if (!user.lockedUntil) {
      return;
    }

    const now = Date.now();
    const lockedUntil = user.lockedUntil.getTime();
    if (lockedUntil <= now) {
      user.lockedUntil = null;
      user.failedLoginAttempts = 0;
      await this.userRepository.save(user);
      await this.securityEventLogger
        .logEvent({
          eventType: SecurityEventType.AUTH_ACCOUNT_AUTO_UNLOCKED,
          userId: user.id,
          email: user.email,
          description: `Account auto-unlocked after lock expiry for ${user.email}`,
          metadata: { email: user.email },
        })
        .catch((err: unknown) =>
          this.logger.warn(
            `Failed to log auto-unlock event: ${(err as Error).message}`,
          ),
        );
      return;
    }

    const requireVerification = this.configService.get<boolean>(
      'REQUIRE_EMAIL_VERIFICATION',
      false,
    );
    if (requireVerification && !user.emailVerified) {
      throw new ForbiddenException(
        JSON.stringify({
          code: ErrorCode.AUTH_EMAIL_NOT_VERIFIED,
          message: 'Please verify your email address before logging in',
        }),
      );
    }
  }

  private async recordFailedLoginAttempt(user: UserEntity) {
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    if (user.failedLoginAttempts >= this.maxFailedLoginAttempts) {
      const lockedUntil = new Date();
      lockedUntil.setMinutes(
        lockedUntil.getMinutes() + this.accountLockMinutes,
      );
      user.lockedUntil = lockedUntil;
      await this.userRepository.save(user);
      await this.securityEventLogger
        .logEvent({
          eventType: SecurityEventType.AUTH_ACCOUNT_LOCKED,
          userId: user.id,
          email: user.email,
          description: `Account locked after ${user.failedLoginAttempts} failed login attempts for ${user.email}`,
          metadata: {
            email: user.email,
            failedAttempts: user.failedLoginAttempts,
            lockedUntil,
          },
        })
        .catch((err: unknown) =>
          this.logger.warn(
            `Failed to log account lock event: ${(err as Error).message}`,
          ),
        );
      return;
    }
    await this.userRepository.save(user);
  }

  private async resetLoginAttempts(user: UserEntity) {
    if (!user.failedLoginAttempts && !user.lockedUntil) {
      return;
    }
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    await this.userRepository.save(user);
  }

  private async createSession(
    user: UserEntity,
    sessionId: string,
    ttlSeconds: number,
    meta: SessionMetadata = {},
  ) {
    const key = this.sessionKey(sessionId);
    const sessionData: Record<string, string> = {
      userId: user.id,
      email: user.email,
      role: user.role,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      ...(meta.ipAddress && { ipAddress: meta.ipAddress }),
      ...(meta.userAgent && { userAgent: meta.userAgent }),
      ...(meta.geoHint && { geoHint: meta.geoHint }),
    };

    await this.circuitBreaker.execute(
      async () => {
        await this.redis.hset(key, sessionData);
        await this.redis.expire(key, ttlSeconds);
        await this.redis.zadd(
          this.userSessionsKey(user.id),
          Date.now(),
          sessionId,
        );
      },
      async () => {
        await this.fallbackStore.setSession(sessionId, sessionData, ttlSeconds);
        await this.fallbackStore.addUserSession(user.id, sessionId);
      },
    );

    // Persist to database
    try {
      await this.authSessionRepository.create({
        sessionId,
        userId: user.id,
        email: user.email,
        role: user.role,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
        ipAddress: meta.ipAddress ?? undefined,
        userAgent: meta.userAgent ?? undefined,
        geoHint: meta.geoHint ?? undefined,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to persist session to database: ${(error as Error).message}`,
      );
    }
  }

  private async touchSession(
    userId: string,
    sessionId: string,
    ttlSeconds: number,
  ) {
    const key = this.sessionKey(sessionId);
    await this.circuitBreaker.execute(
      async () => {
        await this.redis.expire(key, ttlSeconds);
        await this.redis.zadd(
          this.userSessionsKey(userId),
          Date.now(),
          sessionId,
        );
      },
      async () => {
        // Fallback store doesn't need explicit touch as it uses setTimeout for TTL
      },
    );

    try {
      await this.authSessionRepository.updateLastActivity(sessionId);
    } catch (error: unknown) {
      this.logger.warn(
        `Failed to update session activity in DB: ${(error as Error).message}`,
      );
    }
  }

  private async getSessionById(
    sessionId: string,
  ): Promise<Record<string, string> | null> {
    const key = this.sessionKey(sessionId);
    return this.circuitBreaker.execute(
      async () => {
        const session = await this.redis.hgetall(key);
        return Object.keys(session).length > 0 ? session : null;
      },
      async () => {
        return this.fallbackStore.getSession(sessionId);
      },
    );
  }

  private userSessionsKey(userId: string): string {
    return `auth:user-sessions:${userId}`;
  }

  private sessionKey(sessionId: string): string {
    return `auth:session:${sessionId}`;
  }

  private getRefreshTokenExpirySeconds(): number {
    const expires =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';
    if (expires.endsWith('d')) {
      return parseInt(expires) * 24 * 60 * 60;
    }
    if (expires.endsWith('h')) {
      return parseInt(expires) * 60 * 60;
    }
    return 604800; // 7 days default
  }

  private async enforceConcurrentSessionLimit(userId: string) {
    const maxSessions = this.configService.get<number>(
      'MAX_CONCURRENT_SESSIONS',
      5,
    );
    const sessionIds = await this.redis.zrange(
      this.userSessionsKey(userId),
      0,
      -1,
    );

    if (sessionIds.length > maxSessions) {
      const toRevoke = sessionIds.slice(0, sessionIds.length - maxSessions);
      await Promise.all(toRevoke.map((sid) => this.revokeSession(userId, sid)));
      this.logger.log(
        `Enforced session limit for user ${userId}, revoked ${toRevoke.length} sessions`,
      );
    }
  }

  /**
   * Admin-only functionality to revoke all sessions for a specific user.
   */
  async revokeAllUserSessionsByAdmin(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(
        JSON.stringify({
          code: ErrorCode.USER_NOT_FOUND,
          message: 'User not found',
        }),
      );
    }

    this.logger.log(`Admin revoking all sessions for user: ${userId}`);

    // 1. Get all session IDs from Redis
    const sessionIds = await this.redis.zrange(
      this.userSessionsKey(userId),
      0,
      -1,
    );

    // 2. Revoke each session in Redis
    await Promise.all(
      sessionIds.map(async (sessionId) => {
        await this.redis.hset(
          this.sessionKey(sessionId),
          'revokedAt',
          new Date().toISOString(),
        );
        // We could also delete them, but setting revokedAt allows for consistent logic in getSessionById
      }),
    );

    // 3. Clean up the user's session index in Redis
    await this.redis.del(this.userSessionsKey(userId));

    // 4. Revoke in Database
    await this.authSessionRepository.revokeUserSessions(
      userId,
      'Revoked by Admin',
    );

    // 5. Fallback store (if active)
    const fallbackSessions = await this.fallbackStore.getUserSessions(userId);
    await Promise.all(
      fallbackSessions.map((sid) => this.fallbackStore.revokeSession(sid)),
    );

    return {
      message: `Successfully revoked ${sessionIds.length || fallbackSessions.length || 'all'} sessions for user ${userId}`,
      userId,
      revokedCount: Math.max(sessionIds.length, fallbackSessions.length),
    };
  }
}
