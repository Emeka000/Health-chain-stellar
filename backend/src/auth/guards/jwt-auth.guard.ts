import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Global JWT authentication guard.
 *
 * - Skips routes decorated with @Public().
 * - Validates the Bearer token from the Authorization header.
 * - Returns 401 with an informative message when the token is missing or invalid.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRequest<TUser = any>(err: any, user: any, info: any): TUser {
    if (err || !user) {
      const message =
        info?.message ??
        (info?.name === 'TokenExpiredError'
          ? 'Token has expired'
          : 'Unauthorized: invalid or missing token');
      throw err || new UnauthorizedException(message);
    }
    return user as TUser;
  }
}
