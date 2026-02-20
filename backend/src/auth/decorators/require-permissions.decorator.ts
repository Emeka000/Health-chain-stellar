import { SetMetadata } from '@nestjs/common';
import { Permission } from '../enums/permission.enum';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares which permissions are required to access a route.
 * ALL listed permissions must be present on the user's role.
 *
 * @example
 * @RequirePermissions(Permission.CREATE_ORDER)
 * @Post()
 * createOrder() {}
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
