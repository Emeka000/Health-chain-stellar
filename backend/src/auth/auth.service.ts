import { randomBytes } from 'crypto';

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

import { REDIS_CLIENT } from '../redis/redis.constants';
import { RedisCircuitBreaker } from '../redis/redis-circuit-breaker';
import { AuthSessionFallbackStore } from '../redis/auth-session-fallback.store';
import { UserEntity } from '../users/entities/user.entity';
import { ErrorCode } from '../common/errors/error-codes.enum';

import { JwtPayload } from './jwt.strategy';
import { hashPassword, verifyPassword } from './utils/password.util';
import { AuthSessionRepository } from './repositories/auth-session.repository';

const PASSWORD_HISTORY_LIMIT = 3;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly circuitBreaker: RedisCircuitBreaker;
  private readonly fallbackStore: AuthSessionFallbackStore;
  private readonly maxFailedLoginAttempts: number;
  private readonly accountLockMinutes: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly authSessionRepository: AuthSessionRepository,
  ) {
    this.circuitBreaker = new RedisCircuitBreaker();
    this.fallbackStore = new AuthSessionFallbackStore();
    this.maxFailedLoginAttempts = this.configService.get<number>('MAX_FAILED_LOGIN_ATTEMPTS', 5);
    this.accountLockMinutes = this.configService.get<number>('ACCOUNT_LOCK_MINUTES', 15);
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

  async login(loginDto: { email: string; password: string; role?: string }) {
    const user = await this.userRepository.findOne({
      where: { email: loginDto.email.toLowerCase() },
    });
    if (!user || !user.passwordHash) {
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
      throw new UnauthorizedException(
        JSON.stringify({
          code: ErrorCode.AUTH_INVALID_CREDENTIALS,
          message: 'Invalid email or password',
        }),
      );
    }

    await this.resetLoginAttempts(user);

    const sessionId = randomBytes(16).toString('hex');
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role ?? loginDto.role ?? 'donor',
      sid: sessionId,
    };

    const { accessToken, refreshToken, refreshExpiresInSeconds } =
      await this.issueTokens(payload);
    await this.createSession(user, sessionId, refreshExpiresInSeconds);
    await this.enforceConcurrentSessionLimit(user.id);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  }

  async register(registerDto: {
    email: string;
    password: string;
    role?: string;
    name?: string;
  }) {
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
    const user = this.userRepository.create({
      email,
      name: registerDto.name,
      role: registerDto.role ?? 'donor',
      passwordHash,
      passwordHistory: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
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
      const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get<string>(
          'JWT_REFRESH_SECRET',
          'refresh-secret',
        ),
      });

      const tokenKey = `auth:refresh-consumed:${refreshToken}`;
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
        this.logger.warn(
          `Replay attack detected for user ${payload.email}. Token already consumed.`,
        );
        throw new UnauthorizedException(
          JSON.stringify({
            code: ErrorCode.AUTH_INVALID_REFRESH_TOKEN,
            message: 'Invalid refresh token',
          }),
        );
      }

      if (!payload.sid) {
        throw new UnauthorizedException(
          JSON.stringify({
            code: ErrorCode.AUTH_INVALID_REFRESH_TOKEN,
            message: 'Invalid refresh token',
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
      } = await this.issueTokens(newPayload);
      await this.touchSession(
        payload.sub,
        payload.sid,
        refreshExpiresInSeconds,
      );

      return {
        access_token: newAccessToken,
        refresh_token: newRefreshToken,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`Refresh token failed: ${error.message}`);
      throw new UnauthorizedException(
        JSON.stringify({
          code: ErrorCode.AUTH_INVALID_REFRESH_TOKEN,
          message: 'Invalid or expired refresh token',
        }),
      );
    }
  }

  private async issueTokens(payload: JwtPayload): Promise<{
    accessToken: string;
    refreshToken: string;
    refreshExpiresInSeconds: number;
  }> {
    const accessToken = this.jwtService.sign(
      payload as unknown as Record<string, unknown>,
    );
    const refreshToken = await this.generateRefreshToken(payload);
    return {
      accessToken,
      refreshToken,
      refreshExpiresInSeconds: this.getRefreshTokenExpirySeconds(),
    };
  }

  private async generateRefreshToken(payload: JwtPayload): Promise<string> {
    const jti = randomBytes(16).toString('hex');
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    const refreshToken = this.jwtService.sign(
      { ...payload, jti } as unknown as Record<string, unknown>,
      {
        secret:
          this.configService.get<string>('JWT_REFRESH_SECRET') ??
          'refresh-secret',

        expiresIn: refreshExpiresIn as any,
      },
    );

    return refreshToken;
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

    // Persist revocation to database
    try {
      await this.authSessionRepository.revokeSession(sessionId, 'User logout');
    } catch (error) {
      this.logger.warn(
        `Failed to persist session revocation to database: ${error.message}`,
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
    ].slice(0, PASSWORD_HISTORY_LIMIT);
    for (const hash of recentHashes) {
      if (await verifyPassword(newPassword, hash)) {
        throw new BadRequestException(
          JSON.stringify({
            code: ErrorCode.AUTH_PASSWORD_REUSE,
            message: `Cannot reuse any of your last ${PASSWORD_HISTORY_LIMIT} passwords`,
          }),
        );
      }
    }

    const newHash = await hashPassword(newPassword);
    user.passwordHistory = [
      user.passwordHash,
      ...(user.passwordHistory ?? []),
    ].slice(0, PASSWORD_HISTORY_LIMIT);
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
      return;
    }

    throw new ForbiddenException(
      JSON.stringify({
        code: ErrorCode.AUTH_ACCOUNT_LOCKED,
        message: 'Account is locked. Please try again later',
      }),
    );
  }

  private async recordFailedLoginAttempt(user: UserEntity) {
    user.failedLoginAttempts = (user.failedLoginAttempts ?? 0) + 1;
    if (user.failedLoginAttempts >= this.maxFailedLoginAttempts) {
      const lockedUntil = new Date();
      lockedUntil.setMinutes(lockedUntil.getMinutes() + this.accountLockMinutes);
      user.lockedUntil = lockedUntil;
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
  ) {
    const key = this.sessionKey(sessionId);
    const sessionData = {
      userId: user.id,
      email: user.email,
      role: user.role,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
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
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist session to database: ${error.message}`,
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
    } catch (error) {
      this.logger.warn(
        `Failed to update session activity in DB: ${error.message}`,
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
    const maxSessions = this.configService.get<number>('MAX_CONCURRENT_SESSIONS', 5);
    const sessionIds = await this.redis.zrange(this.userSessionsKey(userId), 0, -1);
    
    if (sessionIds.length > maxSessions) {
      const toRevoke = sessionIds.slice(0, sessionIds.length - maxSessions);
      await Promise.all(toRevoke.map(sid => this.revokeSession(userId, sid)));
      this.logger.log(`Enforced session limit for user ${userId}, revoked ${toRevoke.length} sessions`);
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
