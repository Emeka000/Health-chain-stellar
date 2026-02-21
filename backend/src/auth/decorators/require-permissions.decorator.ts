import { SetMetadata } from '@nestjs/common';
import { Permission } from '../enums/permission.enum';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Decorator that attaches the required permissions for a route.
 * Used in conjunction with PermissionsGuard.
 *
 * @example
 * @RequirePermissions(Permission.CREATE_ORDER)
 * @Post()
 * create() {}
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
