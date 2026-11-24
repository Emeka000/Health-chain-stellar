import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { UserRole } from '../../auth/enums/user-role.enum';
import { AdminScope } from '../enums/admin-scope.enum';
import { ADMIN_SCOPE_KEY } from '../decorators/require-admin-scope.decorator';
import type { JwtPayload } from '../../auth/jwt.strategy';

/**
 * BlockchainAdminGuard
 *
 * Protects blockchain admin endpoints using the identity already established
 * by the global JwtAuthGuard (which verifies tokens via JwtKeyService and
 * supports key rotation).
 *
 * - Relies on `request.user` populated by the global JwtAuthGuard.
 * - Ensures the authenticated user holds the `admin` role.
 * - Optionally enforces a required AdminScope set via @RequireAdminScope().
 * - Logs every access attempt (success and failure) with actor identity.
 *
 * Does NOT re-verify the JWT or overwrite `request.user`, so `sid` and
 * `organizationId` are preserved for downstream consumers.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, path, ip } = request;

    // ── 1. Read identity from the global JwtAuthGuard ───────────────────────
    const user = (request as any).user as JwtPayload | undefined;
    if (!user) {
      this.logger.warn(
        `[AdminGuard] 401 — unauthenticated request | ${method} ${path} | ip=${ip}`,
      );
      throw new UnauthorizedException(
        'Authentication required. Please provide a valid Bearer token.',
      );
    }

    // ── 2. Check admin role ─────────────────────────────────────────────────
    const userRole = user.role as UserRole;
    if (userRole !== UserRole.ADMIN) {
      this.logger.warn(
        `[AdminGuard] 403 — insufficient role | userId=${user.sub} | role=${userRole} | ${method} ${path}`,
      );
      throw new ForbiddenException(
        'Admin role required to access this resource.',
      );
    }

    // ── 3. Check required AdminScope (if set on the handler) ───────────────
    const requiredScope = this.reflector.getAllAndOverride<AdminScope>(
      ADMIN_SCOPE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredScope) {
      const hasScope = this.checkScope(userRole, requiredScope);
      if (!hasScope) {
        this.logger.warn(
          `[AdminGuard] 403 — insufficient scope | userId=${user.sub} | required=${requiredScope} | ${method} ${path}`,
        );
        throw new ForbiddenException(
          `Insufficient permissions. Required scope: ${requiredScope}`,
        );
      }
    }

    // ── 4. Audit log (request.user is left untouched) ──────────────────────
    this.logger.log(
      `[AdminGuard] Access granted | userId=${user.sub} | email=${user.email} | ${method} ${path}${requiredScope ? ` | scope=${requiredScope}` : ''}`,
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
