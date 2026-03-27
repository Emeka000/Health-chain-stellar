import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

import {
  RATE_LIMIT_KEY,
  RateLimitConfig,
} from '../decorators/rate-limit.decorator';

@Injectable()
export class EndpointRateLimitGuard extends ThrottlerGuard {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rateLimitConfig = this.reflector.get<RateLimitConfig>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    if (rateLimitConfig) {
      const request = context.switchToHttp().getRequest();
      const key = `${request.ip}:${request.path}`;

      // Store custom limit in request for throttler to use
      request.rateLimit = rateLimitConfig;
    }

    return super.canActivate(context);
  }
}
