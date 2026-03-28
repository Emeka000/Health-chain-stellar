import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { REGION_SCOPED_KEY } from '../decorators/region-scope.decorator';

export const REGIONAL_ADMIN_ROLE = 'regional_admin';

/**
 * Enforces region visibility constraints on regional admins.
 *
 * - Super admins and non-regional-admin roles pass through unrestricted.
 * - Regional admins must have a `regionCode` claim in their JWT payload.
 * - The request must carry a `region` query param or body field matching
 *   the admin's assigned region code.
 */
@Injectable()
export class RegionScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isRegionScoped = this.reflector.getAllAndOverride<boolean>(
      REGION_SCOPED_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!isRegionScoped) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Unauthorized');
    }

    // Super admins bypass region scoping
    if (user.role === 'admin' || user.role === 'super_admin') {
      return true;
    }

    // Non-regional roles pass through (their module-level permissions apply)
    if (user.role !== REGIONAL_ADMIN_ROLE) {
      return true;
    }

    // Regional admin must have a region code in their JWT
    const adminRegion: string | undefined = user.regionCode;
    if (!adminRegion) {
      throw new ForbiddenException(
        'Regional admin account is not assigned to any region',
      );
    }

    // Determine requested region from query param, route param, or body
    const requestedRegion: string | undefined =
      request.query?.region ||
      request.params?.region ||
      request.body?.region ||
      request.body?.regionCode;

    if (!requestedRegion) {
      // No region filter provided — inject the admin's own region automatically
      request.query = { ...request.query, region: adminRegion };
      return true;
    }

    if (requestedRegion.toUpperCase() !== adminRegion.toUpperCase()) {
      throw new ForbiddenException(
        `Access denied: you can only access data for region "${adminRegion}"`,
      );
    }

    return true;
  }
}
