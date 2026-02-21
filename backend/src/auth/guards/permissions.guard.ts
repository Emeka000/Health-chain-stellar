import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '../enums/permission.enum';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PermissionsService } from '../permissions.service';

/**
 * Guard that enforces fine-grained, decorator-driven RBAC.
 *
 * Reads the list of required permissions from @RequirePermissions(), loads the
 * authenticated user's role permissions (from Redis cache → DB fallback), and
 * returns a structured 403 when any required permission is missing.
 *
 * This guard should run **after** JwtAuthGuard so `request.user` is populated.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip public routes
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No @RequirePermissions() on this route → allow (auth was already enforced)
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { id: string; email: string; role: string };
    }>();
    const user = request.user;

    if (!user?.role) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Forbidden: missing role information',
        requiredPermissions,
      });
    }

    const userPermissions = await this.permissionsService.getPermissionsForRole(
      user.role,
    );

    const missingPermissions = requiredPermissions.filter(
      (permission) => !userPermissions.includes(permission),
    );

    if (missingPermissions.length > 0) {
      throw new ForbiddenException({
        statusCode: 403,
        message: 'Forbidden: insufficient permissions',
        requiredPermission: missingPermissions[0],
        requiredPermissions: missingPermissions,
      });
    }

    return true;
  }
}
