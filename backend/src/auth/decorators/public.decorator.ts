import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a route or controller as publicly accessible, bypassing JWT auth
 * and permissions checks.
 *
 * @example
 * @Public()
 * @Post('login')
 * login() {}
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
