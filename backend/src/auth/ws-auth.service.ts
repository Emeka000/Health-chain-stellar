/**
 * WebSocket JWT Authentication Middleware
 *
 * Replicates exact HTTP JWT + RBAC verification for socket.io connections.
 * Enforces tenant isolation, rate limiting, and security audit trail.
 *
 * Issues #562: Secure WebSocket Gateways with JWT + RBAC
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import Redis from 'ioredis';
import { Inject } from '@nestjs/common';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { SecurityEventLoggerService } from '../user-activity/security-event-logger.service';
import { JwtKeyService } from './jwt-key.service';

/**
 * Authenticated socket with user context attached
 */
export interface AuthenticatedSocket extends Socket {
  user?: {
    userId: string;
    tenantId: string;
    email?: string;
    role?: string;
    roles?: string[];
    permissions?: string[];
    iat: number;
    exp: number;
    sid?: string;
    keyid?: string;
  };
  data: {
    userId?: string;
    tenantId?: string;
    role?: string;
    hospitalIds?: string[];
  };
}

export interface WsAuthOptions {
  rateLimit?: {
    enabled: boolean;
    maxConnections: number;
    windowSeconds: number;
  };
  auditEnabled?: boolean;
}

/**
 * WebSocket Authentication Service
 *
 * Responsibilities:
 * - Extract JWT from handshake.auth.token or Authorization header
 * - Verify signature using same JWT_SECRET as HTTP endpoints
 * - Validate claims (userId, tenantId, role, expiry)
 * - Enforce rate limiting per userId+IP
 * - Log security events (failures, privilege violations, suspicious patterns)
 * - Attach user context to socket for use in event handlers
 */
@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);

  // Rate limit tracking
  private readonly rateLimitCache: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly jwtKeyService: JwtKeyService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly securityEventLogger: SecurityEventLoggerService,
  ) {}

  /**
   * Authenticate WebSocket connection from handshake
   *
   * Called via socket.io middleware:
   * ```
   * io.use(wsAuthService.authenticate())
   * ```
   *
   * @returns Socket.io middleware function
   */
  authenticate(options?: WsAuthOptions) {
    const finalOptions = {
      rateLimit: { enabled: true, maxConnections: 10, windowSeconds: 60 },
      auditEnabled: true,
      ...options,
    };

    return async (socket: AuthenticatedSocket, next: (err?: Error) => void) => {
      try {
        // ─────────────────────────────────────────────────────────────────────
        // 1. EXTRACT TOKEN
        // ─────────────────────────────────────────────────────────────────────
        const token = this.extractToken(socket);

        if (!token) {
          const err = new Error('Authentication token required');
          await this.auditEvent('WS_NO_TOKEN', {
            socketId: socket.id,
            ip: socket.handshake.address,
            userAgent: socket.handshake.headers['user-agent'],
          });
          return next(err);
        }

        // ─────────────────────────────────────────────────────────────────────
        // 2. VERIFY JWT SIGNATURE & CLAIMS (EXACT HTTP PARITY)
        // ─────────────────────────────────────────────────────────────────────
        let decoded: AuthenticatedSocket['user'];

        try {
          decoded = await this.verifyToken(token);
        } catch (error) {
          const err = new Error(`Invalid or expired token: ${(error as Error).message}`);
          await this.auditEvent('WS_INVALID_TOKEN', {
            socketId: socket.id,
            ip: socket.handshake.address,
            error: (error as Error).message,
            tokenPreview: token.substring(0, 20),
          });
          return next(err);
        }

        // ─────────────────────────────────────────────────────────────────────
        // 3. VALIDATE CLAIMS STRUCTURE
        // ─────────────────────────────────────────────────────────────────────
        if (!decoded.userId || !decoded.tenantId) {
          const err = new Error('Invalid token claims: missing userId or tenantId');
          await this.auditEvent('WS_INVALID_CLAIMS', {
            socketId: socket.id,
            ip: socket.handshake.address,
            userId: decoded.userId,
            tenantId: decoded.tenantId,
          });
          return next(err);
        }

        // ─────────────────────────────────────────────────────────────────────
        // 4. RATE LIMIT CHECK (10 connections/min per userId+IP)
        // ─────────────────────────────────────────────────────────────────────
        if (finalOptions.rateLimit?.enabled) {
          const rateLimitOk = await this.checkRateLimit(
            decoded.userId,
            socket.handshake.address,
            finalOptions.rateLimit.maxConnections,
            finalOptions.rateLimit.windowSeconds,
          );

          if (!rateLimitOk) {
            const err = new Error('Rate limit exceeded: too many connections');
            await this.auditEvent('WS_RATE_LIMITED', {
              socketId: socket.id,
              userId: decoded.userId,
              ip: socket.handshake.address,
            });
            return next(err);
          }
        }

        // ─────────────────────────────────────────────────────────────────────
        // 5. ATTACH USER TO SOCKET (accessible in all handlers)
        // ─────────────────────────────────────────────────────────────────────
        (socket as AuthenticatedSocket).user = decoded;

        // Also attach to socket.data for compatibility with existing gateway code
        socket.data.userId = decoded.userId;
        socket.data.tenantId = decoded.tenantId;
        socket.data.role = decoded.role;

        // Log successful authentication
        this.logger.log(
          `WS authenticated: socketId=${socket.id} userId=${decoded.userId} tenantId=${decoded.tenantId} role=${decoded.role}`,
        );

        await this.auditEvent('WS_AUTH_SUCCESS', {
          socketId: socket.id,
          userId: decoded.userId,
          tenantId: decoded.tenantId,
          role: decoded.role,
          ip: socket.handshake.address,
        });

        next();
      } catch (error) {
        this.logger.error(
          `WS auth error: ${(error as Error).message}`,
          (error as Error).stack,
        );

        const err = new Error('Authentication failed');
        await this.auditEvent('WS_AUTH_ERROR', {
          socketId: socket.id,
          ip: socket.handshake.address,
          error: (error as Error).message,
        });

        next(err);
      }
    };
  }

  /**
   * Extract JWT from either auth object or Authorization header
   *
   * Precedence:
   * 1. socket.handshake.auth.token
   * 2. socket.handshake.headers.authorization (Bearer scheme)
   */
  private extractToken(socket: AuthenticatedSocket): string | null {
    // Try auth object first (client sends { auth: { token: '...' } })
    if (socket.handshake?.auth?.token) {
      return socket.handshake.auth.token as string;
    }

    // Try Authorization header (client sends { headers: { authorization: 'Bearer ...' } })
    const authHeader = socket.handshake?.headers?.authorization;
    if (authHeader && typeof authHeader === 'string') {
      if (authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
      }
    }

    return null;
  }

  /**
   * Verify JWT signature and expiry (EXACT HTTP PARITY)
   *
   * Uses same secret resolution as HTTP guards:
   * 1. Active JWT_SECRET (from JwtKeyService)
   * 2. Previous JWT_SECRET (grace period during rotation)
   *
   * @throws Error if token is invalid, expired, or claims are missing
   */
  private async verifyToken(token: string): Promise<AuthenticatedSocket['user']> {
    // Decode without verification first to get header info
    const decodedHeader = this.jwtService.decode(token, { complete: true }) as any;

    if (!decodedHeader) {
      throw new Error('Invalid token format');
    }

    const kid = decodedHeader.header?.kid;
    const secret = kid
      ? this.jwtKeyService.resolveSecret(kid)
      : this.configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new Error('Unable to resolve JWT secret');
    }

    // Verify with resolved secret (throws if invalid or expired)
    const payload = this.jwtService.verify<any>(token, {
      secret,
    });

    // Additional expiry check (should be redundant with jwt.verify, but explicit)
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      throw new Error('Token expired');
    }

    // Map HTTP JWT claims to WS user object
    return {
      userId: payload.sub || payload.userId,
      tenantId: payload.hospitalId || payload.tenantId,
      email: payload.email,
      role: payload.role,
      roles: payload.roles || (payload.role ? [payload.role] : []),
      permissions: payload.permissions || [],
      iat: payload.iat,
      exp: payload.exp,
      sid: payload.sid,
      keyid: kid,
    };
  }

  /**
   * Rate limit enforcement: max N connections per userId+IP in window
   *
   * Uses Redis with fallback to in-memory map if Redis unavailable.
   *
   * @returns true if within limit, false if exceeded
   */
  private async checkRateLimit(
    userId: string,
    ip: string,
    maxConnections: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const key = `ws_conn:${userId}:${ip}`;
    const now = Date.now();

    try {
      // Try Redis first
      const count = await this.redis.incr(key);

      if (count === 1) {
        // First connection in window, set expiry
        await this.redis.expire(key, windowSeconds);
      }

      return count <= maxConnections;
    } catch (redisError) {
      this.logger.warn(`Redis rate limit check failed: ${(redisError as Error).message}`);

      // Fallback to in-memory tracking
      let entry = this.rateLimitCache.get(key);
      if (!entry || entry.resetAt < now) {
        entry = { count: 0, resetAt: now + windowSeconds * 1000 };
      }

      entry.count++;
      this.rateLimitCache.set(key, entry);

      // Cleanup expired entries periodically
      if (this.rateLimitCache.size > 10000) {
        for (const [k, v] of this.rateLimitCache.entries()) {
          if (v.resetAt < now) {
            this.rateLimitCache.delete(k);
          }
        }
      }

      return entry.count <= maxConnections;
    }
  }

  /**
   * Log security events to audit trail
   *
   * All authentication and privilege violations are recorded for compliance.
   */
  private async auditEvent(
    eventType: string,
    metadata: Record<string, any>,
  ): Promise<void> {
    try {
      // Map to SecurityEventType if exists
      const eventMap: Record<string, string> = {
        WS_NO_TOKEN: 'WS_NO_TOKEN',
        WS_INVALID_TOKEN: 'WS_INVALID_TOKEN',
        WS_INVALID_CLAIMS: 'WS_INVALID_CLAIMS',
        WS_PRIVILEGE_VIOLATION: 'WS_PRIVILEGE_VIOLATION',
        WS_TENANT_ESCAPE_ATTEMPT: 'WS_TENANT_ESCAPE_ATTEMPT',
        WS_RATE_LIMITED: 'WS_RATE_LIMITED',
        WS_AUTH_SUCCESS: 'WS_AUTH_SUCCESS',
        WS_AUTH_ERROR: 'WS_AUTH_ERROR',
        WS_TOKEN_REFRESH_FAILED: 'WS_TOKEN_REFRESH_FAILED',
      };

      const finalEventType = eventMap[eventType] || eventType;

      await this.securityEventLogger.logEvent({
        eventType: finalEventType as any,
        userId: metadata.userId || null,
        metadata,
        ipAddress: metadata.ip,
        userAgent: metadata.userAgent,
      });
    } catch (error) {
      this.logger.error(
        `Failed to log security event: ${(error as Error).message}`,
      );
    }
  }
}

/**
 * Socket.io Middleware Adapter
 *
 * Exports the middleware function for use in gateway initialization.
 *
 * Usage:
 * ```typescript
 * constructor(private wsAuth: WsAuthService) {}
 *
 * afterInit(server: Server) {
 *   server.use(this.wsAuth.authenticate());
 * }
 * ```
 */
export function createWsAuthMiddleware(wsAuthService: WsAuthService) {
  return wsAuthService.authenticate();
}
