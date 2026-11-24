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
 * - The requested region is resolved from query/route/body params; when none
 *   is provided the admin's own region is exposed via `request.regionScope`
 *   (never by mutating `request.query`, which is a getter on Express 5).
 * - Route handlers scoped by `:id` should compare the loaded region's code
 *   against `request.regionScope` and return 403 on mismatch.
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

    if (requestedRegion) {
      if (requestedRegion.toUpperCase() !== adminRegion.toUpperCase()) {
        throw new ForbiddenException(
          `Access denied: you can only access data for region "${adminRegion}"`,
        );
      }
    }

    // Expose the admin's region scope without mutating req.query (Express 5
    // makes req.query a getter-only property). Handlers can read this to
    // filter results or to compare against a loaded region's code.
    request.regionScope = adminRegion;

    return true;
  }
}
