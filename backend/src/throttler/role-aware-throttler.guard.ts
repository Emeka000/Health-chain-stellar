import { Inject, Injectable, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  THROTTLER_OPTIONS,
} from '@nestjs/throttler';

import type Redis from 'ioredis';

import {
  ROLE_THROTTLE_LIMITS,
  THROTTLE_TTL_MS,
  DEFAULT_THROTTLE_LIMIT,
  TENANT_THROTTLE_LIMITS,
  EMERGENCY_ROLES,
  EMERGENCY_WEIGHT
} from '../config/throttle-limits.config';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { throttleGetTracker } from './throttle-tracker.util';

const ABUSE_TRACKER_KEY_PREFIX = 'throttle:abuse:';
const ABUSE_TRACKER_TTL_SEC = 3600; // matches the 1-hour adaptive block cap

@Injectable()
export class RoleAwareThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(RoleAwareThrottlerGuard.name);

  constructor(
    @Inject(THROTTLER_OPTIONS) options: ThrottlerModuleOptions,
    @Inject(ThrottlerStorage) storageService: ThrottlerStorage,
    reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super(options, storageService, reflector);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return throttleGetTracker(req, null as any);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tracker = await this.getTracker(request);
    const user = request.user as { role?: string; orgId?: string; id?: string } | undefined;

    // Check base throttling
    const allowed = await super.canActivate(context);

    // Adaptive penalty state lives in Redis so it is shared across all
    // horizontally-scaled instances and evicted automatically via TTL.
    const abuseKey = `${ABUSE_TRACKER_KEY_PREFIX}${tracker}`;

    if (!allowed) {
      // Adaptive penalty: track violations and increase block duration
      const violations = await this.redis.incr(abuseKey);
      await this.redis.expire(abuseKey, ABUSE_TRACKER_TTL_SEC);

      // Adaptive block duration based on violation count
      const adaptiveBlockMs = Math.min(THROTTLE_TTL_MS * Math.pow(2, violations - 1), 3600000); // Max 1 hour

      // Log for observability
      this.logger.warn(`Rate limit exceeded for ${tracker}`, {
        role: user?.role || 'PUBLIC',
        tenantId: user?.orgId || 'unknown',
        endpoint: request.path,
        violations,
        adaptiveBlockMs,
        userId: user?.id,
      });

      // Set retry-after header with adaptive penalty
      const response = context.switchToHttp().getResponse();
      response.set('Retry-After', Math.ceil(adaptiveBlockMs / 1000));
    } else {
      // Reset abuse counter on successful request (gradual decay)
      const exists = await this.redis.exists(abuseKey);
      if (exists) {
        const violations = await this.redis.decr(abuseKey);
        if (violations <= 0) {
          await this.redis.del(abuseKey);
        } else {
          await this.redis.expire(abuseKey, ABUSE_TRACKER_TTL_SEC);
        }
      }
    }

    return allowed;
  }

  protected async getThrottlers(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const user = request.user as { role?: string; orgId?: string } | undefined;

    const role = user?.role || 'PUBLIC';
    const roleLimit = ROLE_THROTTLE_LIMITS[role] || DEFAULT_THROTTLE_LIMIT;

    // Tenant-level throttling
    const tenantId = user?.orgId || 'default';
    const tenantLimit = TENANT_THROTTLE_LIMITS[tenantId] || TENANT_THROTTLE_LIMITS.default;

    // Endpoint-specific limits (basic implementation)
    const endpoint = request.path;
    const isEmergencyEndpoint = endpoint.includes('/emergency') || endpoint.includes('/critical');

    // Weighted fairness: emergency roles and endpoints get higher limits
    const isEmergencyRole = EMERGENCY_ROLES.includes(role as any);
    const weight = (isEmergencyRole || isEmergencyEndpoint) ? EMERGENCY_WEIGHT : 1;

    const adjustedRoleLimit = Math.floor(roleLimit.limit * weight);
    const adjustedTenantLimit = Math.floor(tenantLimit.limit * weight);

    return [
      {
        name: 'user-role',
        ttl: THROTTLE_TTL_MS,
        limit: adjustedRoleLimit,
        blockDuration: 0,
        ignoreUserAgents: [],
      },
      {
        name: 'tenant',
        ttl: THROTTLE_TTL_MS,
        limit: adjustedTenantLimit,
        blockDuration: 0,
        ignoreUserAgents: [],
      },
    ];
  }
}
