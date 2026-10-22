import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UserRole } from '../../auth/enums/user-role.enum';
import { AdminScope } from '../enums/admin-scope.enum';
import { ADMIN_SCOPE_KEY } from '../decorators/require-admin-scope.decorator';
import type { JwtPayload } from '../../auth/jwt.strategy';

/**
 * BlockchainAdminGuard
 *
 * Protects blockchain admin endpoints using JWT-based authentication
 * and role/permission checks.
 *
 * - Extracts the Bearer token from the Authorization header.
 * - Verifies the JWT signature and expiry.
 * - Ensures the authenticated user holds the `admin` role.
 * - Optionally enforces a required AdminScope set via @RequireAdminScope().
 * - Logs every access attempt (success and failure) with actor identity.
 *
 * Replaces the previous static x-admin-key header approach.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, path, ip } = request;

    // ── 1. Extract Bearer token ─────────────────────────────────────────────
    const authHeader = request.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      this.logger.warn(
        `[AdminGuard] 401 — missing Bearer token | ${method} ${path} | ip=${ip}`,
      );
      throw new UnauthorizedException(
        'Authentication required. Please provide a valid Bearer token.',
      );
    }

    const token = authHeader.substring(7);

    // ── 2. Verify JWT ───────────────────────────────────────────────────────
    let payload: JwtPayload;
    try {
      const secret = this.configService.get<string>('JWT_SECRET', 'default-secret');
      payload = this.jwtService.verify<JwtPayload>(token, { secret });
    } catch (err: any) {
      const isExpired = err?.name === 'TokenExpiredError';
      this.logger.warn(
        `[AdminGuard] 401 — ${isExpired ? 'expired token' : 'invalid token'} | ${method} ${path} | ip=${ip}`,
      );
      throw new UnauthorizedException(
        isExpired
          ? 'Token has expired. Please re-authenticate.'
          : 'Invalid token. Authentication failed.',
      );
    }

    // ── 3. Check admin role ─────────────────────────────────────────────────
    const userRole = payload.role as UserRole;
    if (userRole !== UserRole.ADMIN) {
      this.logger.warn(
        `[AdminGuard] 403 — insufficient role | userId=${payload.sub} | role=${userRole} | ${method} ${path}`,
      );
      throw new ForbiddenException(
        'Admin role required to access this resource.',
      );
    }

    // ── 4. Check required AdminScope (if set on the handler) ───────────────
    const requiredScope = this.reflector.getAllAndOverride<AdminScope>(
      ADMIN_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredScope) {
      const hasScope = this.checkScope(userRole, requiredScope);
      if (!hasScope) {
        this.logger.warn(
          `[AdminGuard] 403 — insufficient scope | userId=${payload.sub} | required=${requiredScope} | ${method} ${path}`,
        );
        throw new ForbiddenException(
          `Insufficient permissions. Required scope: ${requiredScope}`,
        );
      }
    }

    // ── 5. Attach user to request & audit log ──────────────────────────────
    (request as any).user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
    };

    this.logger.log(
      `[AdminGuard] Access granted | userId=${payload.sub} | email=${payload.email} | ${method} ${path}${requiredScope ? ` | scope=${requiredScope}` : ''}`,
    );

    return true;
  }

  /**
   * Checks whether the user's role satisfies the required AdminScope.
   * ADMIN_FULL grants access to all scopes.
   */
  private checkScope(role: UserRole, required: AdminScope): boolean {
    if (role !== UserRole.ADMIN) return false;

    // Admins have access to all scopes by default.
    // This can be extended to a per-user scope claim from the JWT when needed.
    const scopeHierarchy: AdminScope[] = [
      AdminScope.READ_METRICS,
      AdminScope.MANAGE_DLQ,
      AdminScope.ADMIN_FULL,
    ];

    return scopeHierarchy.includes(required);
  }
}
