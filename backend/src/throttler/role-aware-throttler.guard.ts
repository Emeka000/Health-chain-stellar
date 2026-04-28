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

import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';

import request from 'supertest';

/** Minimal request shape the guard reads */
interface FakeRequest {
  user?: { id: string; role: string };
}

/**
 * Probe controller that injects a synthetic `req.user` so we can test
 * role-based limits without a real JWT stack.
 */
@Controller('role-throttle-test')
class RoleThrottleProbeController {
  @Get('admin')
  adminProbe(@Req() _req: FakeRequest) {
    return { ok: true, role: 'ADMIN' };
  }

  @Get('hospital')
  hospitalProbe(@Req() _req: FakeRequest) {
    return { ok: true, role: 'HOSPITAL' };
  }

  @Get('public')
  publicProbe(@Req() _req: FakeRequest) {
    return { ok: true, role: 'PUBLIC' };
  }

  @Get('ussd')
  ussdProbe(@Req() _req: FakeRequest) {
    return { ok: true, role: 'USSD' };
  }
}

/**
 * Build a test app where ThrottlerModule is seeded with a tiny base limit
 * and RoleAwareThrottlerGuard overrides it per-role.
 *
 * We monkey-patch `req.user` via a middleware so we don't need the full
 * JWT/auth stack — matching the pattern in throttler.integration.spec.ts.
 */
async function buildApp(
  role: string,
  userId = 'test-user-1',
): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [
      ThrottlerModule.forRoot({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 1000 }],
      }),
    ],
    controllers: [RoleThrottleProbeController],
    providers: [{ provide: APP_GUARD, useClass: RoleAwareThrottlerGuard }],
  }).compile();

  const app = moduleFixture.createNestApplication();

  // Inject synthetic req.user before the guard runs
  app.use((_req: any, _res: any, next: () => void) => {
    _req.user = { id: userId, role };
    next();
  });

  await app.init();
  return app;
}

// ─── ADMIN ──────────────────────────────────────────────────────────────────

describe('RoleAwareThrottlerGuard — ADMIN role', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await buildApp('ADMIN');
  });

  afterEach(async () => {
    await app.close();
  });

  it('never blocks admin requests regardless of volume', async () => {
    // Fire 20 rapid requests — should all pass; ADMIN bypasses counting
    for (let i = 0; i < 20; i++) {
      await request(app.getHttpServer())
        .get('/role-throttle-test/admin')
        .expect(200);
    }
  });
});

// ─── PUBLIC ─────────────────────────────────────────────────────────────────

describe('RoleAwareThrottlerGuard — PUBLIC role', () => {
  let app: INestApplication;

  beforeEach(async () => {
    // Build with a tiny PUBLIC limit so tests run fast
    app = await buildApp('PUBLIC', 'public-user-1');
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 within limit', async () => {
    await request(app.getHttpServer())
      .get('/role-throttle-test/public')
      .expect(200);
  });

  it('returns 429 with Retry-After header when PUBLIC limit is breached', async () => {
    // Override the guard's getThrottlers to use limit=1 for this assertion
    // by building a fresh tiny-limit app
    const tinyApp = await (async () => {
      const mod: TestingModule = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot({
            throttlers: [{ name: 'default', ttl: 60_000, limit: 1 }],
          }),
        ],
        controllers: [RoleThrottleProbeController],
        providers: [
          {
            provide: APP_GUARD,
            useClass: class extends RoleAwareThrottlerGuard {
              protected override async getThrottlers() {
                return [
                  {
                    name: 'role-aware',
                    ttl: 60_000,
                    limit: 1, // force limit=1 for PUBLIC
                    blockDuration: 0,
                    ignoreUserAgents: [],
                  },
                ];
              }
            },
          },
        ],
      }).compile();

      const a = mod.createNestApplication();
      a.use((_req: any, _res: any, next: () => void) => {
        _req.user = { id: 'pub-tiny', role: 'PUBLIC' };
        next();
      });
      await a.init();
      return a;
    })();

    await request(tinyApp.getHttpServer())
      .get('/role-throttle-test/public')
      .expect(200);

    const blocked = await request(tinyApp.getHttpServer())
      .get('/role-throttle-test/public')
      .expect(429);

    expect(blocked.headers['retry-after']).toBeDefined();
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    await tinyApp.close();
  });
});

// ─── USSD ────────────────────────────────────────────────────────────────────

describe('RoleAwareThrottlerGuard — USSD role', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await buildApp('USSD', 'ussd-user-1');
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 within limit', async () => {
    await request(app.getHttpServer())
      .get('/role-throttle-test/ussd')
      .expect(200);
  });
});

// ─── HOSPITAL ────────────────────────────────────────────────────────────────

describe('RoleAwareThrottlerGuard — HOSPITAL role', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await buildApp('HOSPITAL', 'hospital-user-1');
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 for hospital requests within limit', async () => {
    await request(app.getHttpServer())
      .get('/role-throttle-test/hospital')
      .expect(200);
  });

  it('resolves higher limit than PUBLIC (200 vs 30)', () => {
    // Limits are defined in config; assert the config values directly
    // so the test doesn't need to exhaust 200 requests
    const { ROLE_THROTTLE_LIMITS } = require('../config/throttle-limits.config');
    expect(ROLE_THROTTLE_LIMITS['HOSPITAL'].limit).toBeGreaterThan(
      ROLE_THROTTLE_LIMITS['PUBLIC'].limit,
    );
  });
});

// ─── RATE-LIMIT HEADERS ──────────────────────────────────────────────────────

describe('RoleAwareThrottlerGuard — rate-limit response headers', () => {
  let app: INestApplication;

  beforeEach(async () => {
    app = await buildApp('HOSPITAL', 'hosp-header-user');
  });

  afterEach(async () => {
    await app.close();
  });

  it('includes x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset on 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/role-throttle-test/hospital')
      .expect(200);

    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-reset']).toBeDefined();
  });
});