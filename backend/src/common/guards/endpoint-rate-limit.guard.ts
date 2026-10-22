import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  seconds,
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';

import {
  RATE_LIMIT_KEY,
  RateLimitConfig,
} from '../decorators/rate-limit.decorator';

/**
 * Throttler guard that honours the per-endpoint `@RateLimit({ limit, ttl })`
 * decorator.
 *
 * `ThrottlerGuard` resolves the limit and TTL for a request inside
 * `handleRequest`, so that is the only place a custom limit can take effect.
 * Overriding it — rather than stashing the config on the request object, which
 * nothing downstream reads — is what makes the decorator actually change
 * throttling behaviour.
 *
 * Endpoints without `@RateLimit()` fall through to the global throttler
 * configuration unchanged.
 */
@Injectable()
export class EndpointRateLimitGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<
      RateLimitConfig | undefined
    >(RATE_LIMIT_KEY, [
      requestProps.context.getHandler(),
      requestProps.context.getClass(),
    ]);

    if (!config) {
      return super.handleRequest(requestProps);
    }

    // `RateLimitConfig.ttl` is documented in seconds; the throttler works in
    // milliseconds, so convert rather than passing the raw value through.
    return super.handleRequest({
      ...requestProps,
      limit: config.limit,
      ttl: seconds(config.ttl),
    });
  }
}
