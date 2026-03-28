import { SetMetadata } from '@nestjs/common';

export const REGION_SCOPED_KEY = 'region_scoped';

/**
 * Mark a route as region-scoped.
 * The RegionScopeGuard will enforce that regional admins can only
 * access resources matching their assigned region.
 */
export const RegionScoped = () => SetMetadata(REGION_SCOPED_KEY, true);
