import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  RATE_LIMIT_KEY,
  RateLimitConfig,
} from '../decorators/rate-limit.decorator';

@Injectable()
export class EndpointRateLimitGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

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
      void key;
    }

    return true;
  }
}
