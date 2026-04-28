import { SetMetadata } from '@nestjs/common';
import { AdminScope } from '../enums/admin-scope.enum';

export const ADMIN_SCOPE_KEY = 'adminScope';

/**
 * Decorator that specifies the minimum AdminScope required to access
 * a blockchain admin endpoint.
 *
 * Usage:
 * @UseGuards(JwtAuthGuard, AdminGuard)
 * @RequireAdminScope(AdminScope.READ_METRICS)
 * @Get('queue/status')
 */
export const RequireAdminScope = (scope: AdminScope) =>
  SetMetadata(ADMIN_SCOPE_KEY, scope);
