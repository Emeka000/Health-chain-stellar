import { Injectable, ExecutionContext, Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import {
  ROLE_THROTTLE_LIMITS,
  THROTTLE_TTL_MS,
  DEFAULT_THROTTLE_LIMIT,
  TENANT_THROTTLE_LIMITS,
  EMERGENCY_ROLES,
  EMERGENCY_WEIGHT
} from '../config/throttle-limits.config';
import { throttleGetTracker } from './throttle-tracker.util';

@Injectable()
export class RoleAwareThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(RoleAwareThrottlerGuard.name);
  private abuseTracker = new Map<string, { violations: number; lastViolation: number }>();

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return throttleGetTracker(req, null as any);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tracker = await this.getTracker(request);
    const user = request.user as { role?: string; orgId?: string; id?: string } | undefined;

    // Check base throttling
    const allowed = await super.canActivate(context);

    if (!allowed) {
      // Adaptive penalty: track violations and increase block duration
      const now = Date.now();
      const abuseKey = tracker;
      const abuseRecord = this.abuseTracker.get(abuseKey) || { violations: 0, lastViolation: 0 };

      abuseRecord.violations++;
      abuseRecord.lastViolation = now;

      // Adaptive block duration based on violation count
      const adaptiveBlockMs = Math.min(THROTTLE_TTL_MS * Math.pow(2, abuseRecord.violations - 1), 3600000); // Max 1 hour

      this.abuseTracker.set(abuseKey, abuseRecord);

      // Log for observability
      this.logger.warn(`Rate limit exceeded for ${tracker}`, {
        role: user?.role || 'PUBLIC',
        tenantId: user?.orgId || 'unknown',
        endpoint: request.path,
        violations: abuseRecord.violations,
        adaptiveBlockMs,
        userId: user?.id,
      });

      // Set retry-after header with adaptive penalty
      const response = context.switchToHttp().getResponse();
      response.set('Retry-After', Math.ceil(adaptiveBlockMs / 1000));
    } else {
      // Reset abuse counter on successful request
      const abuseKey = tracker;
      const abuseRecord = this.abuseTracker.get(abuseKey);
      if (abuseRecord) {
        abuseRecord.violations = Math.max(0, abuseRecord.violations - 1); // Gradual decay
        if (abuseRecord.violations === 0) {
          this.abuseTracker.delete(abuseKey);
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
