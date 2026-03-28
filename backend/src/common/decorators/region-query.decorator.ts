import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Extracts the effective region filter from the request.
 *
 * For regional admins the RegionScopeGuard has already injected their
 * region into request.query.region before this runs, so this will always
 * return a value for that role.
 *
 * Usage:
 *   @Get()
 *   findAll(@RegionQuery() region: string | undefined) { ... }
 */
export const RegionQuery = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return (
      request.query?.region ||
      request.params?.region ||
      request.body?.region ||
      undefined
    );
  },
);
