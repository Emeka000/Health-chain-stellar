import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Repository } from 'typeorm';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { RoleEntity } from './entities/role.entity';
import {
  DecisionTraceStep,
  ScopeDecision,
  ScopeEvaluationContext,
  ScopeGrant,
} from './scope-resolution.types';

const CACHE_TTL_SECONDS = 300;
const SCOPE_CACHE_PREFIX = 'scope:grants:';

@Injectable()
export class ScopeResolutionService {
  private readonly logger = new Logger(ScopeResolutionService.name);

  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @Inject(REDIS_CLIENT)
    private readonly redis: Redis,
  ) {}

  /**
   * Evaluate whether the context is allowed to perform `requestedScope`.
   *
   * Precedence (Issue #619):
   *   1. Explicit DENY  — always wins
   *   2. Explicit ALLOW — wins over inherited
   *   3. Inherited ALLOW — lowest priority
   *
   * Org-boundary: a grant with orgId only applies when context.orgId matches
   * or the grant is global (orgId=null).
   */
  async evaluate(requestedScope: string, ctx: ScopeEvaluationContext): Promise<ScopeDecision> {
    const grants = await this.getGrantsForContext(ctx);
    const matching = grants.filter((g) => this.scopeMatches(g.scope, requestedScope));
    const trace: DecisionTraceStep[] = [];

    // 1. Explicit DENY
    const deny = matching.find((g) => g.effect === 'DENY' && !g.inherited);
    if (deny) {
      trace.push({ scope: requestedScope, effect: 'DENY', matchedGrant: deny, reason: `Explicit DENY on '${deny.scope}'` });
      return { allowed: false, trace };
    }

    // 2. Explicit ALLOW
    const allow = matching.find((g) => g.effect === 'ALLOW' && !g.inherited);
    if (allow) {
      trace.push({ scope: requestedScope, effect: 'ALLOW', matchedGrant: allow, reason: `Explicit ALLOW on '${allow.scope}'` });
      return { allowed: true, trace };
    }

    // 3. Inherited ALLOW
    const inherited = matching.find((g) => g.effect === 'ALLOW' && g.inherited);
    if (inherited) {
      trace.push({ scope: requestedScope, effect: 'ALLOW', matchedGrant: inherited, reason: `Inherited ALLOW on '${inherited.scope}'` });
      return { allowed: true, trace };
    }

    trace.push({
      scope: requestedScope,
      effect: 'DENY',
      matchedGrant: { scope: requestedScope, effect: 'DENY', orgId: null, inherited: false },
      reason: 'No matching grant — default DENY',
    });
    return { allowed: false, trace };
  }

  /** Assert access; throw ForbiddenException with trace if denied (Issue #619). */
  async assertScope(requestedScope: string, ctx: ScopeEvaluationContext): Promise<void> {
    const decision = await this.evaluate(requestedScope, ctx);
    if (!decision.allowed) {
      throw new ForbiddenException({ message: `Access denied for scope '${requestedScope}'`, trace: decision.trace });
    }
  }

  /** Invalidate cached grants for a role after role/scope mutation (Issue #619). */
  async invalidateScopeCache(role: string): Promise<void> {
    try {
      await this.redis.del(`${SCOPE_CACHE_PREFIX}${role}`);
    } catch (err) {
      this.logger.warn(`Scope cache invalidation failed for '${role}': ${(err as Error).message}`);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private async getGrantsForContext(ctx: ScopeEvaluationContext): Promise<ScopeGrant[]> {
    const roleGrants = await this.getRoleGrants(ctx.role);
    const extra = (ctx.extraGrants ?? []).filter((g) => g.orgId === null || g.orgId === ctx.orgId);
    return [...roleGrants, ...extra];
  }

  private async getRoleGrants(role: string): Promise<ScopeGrant[]> {
    const cacheKey = `${SCOPE_CACHE_PREFIX}${role}`;
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as ScopeGrant[];
    } catch { /* fall through */ }

    const roleEntity = await this.roleRepo.findOne({ where: { name: role as any }, relations: ['permissions'] });
    const grants: ScopeGrant[] = (roleEntity?.permissions ?? []).map((rp) => ({
      scope: rp.permission as string,
      effect: 'ALLOW' as const,
      orgId: null,
      inherited: false,
    }));

    try {
      await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(grants));
    } catch { /* non-fatal */ }

    return grants;
  }

  /**
   * Match a grant scope pattern against a requested scope.
   * Supports wildcard (*) at any segment: "view:*", "*:*", "create:order".
   */
  private scopeMatches(pattern: string, requested: string): boolean {
    if (pattern === '*' || pattern === '*:*') return true;
    const pp = pattern.split(':');
    const rp = requested.split(':');
    if (pp.length !== rp.length) return false;
    return pp.every((seg, i) => seg === '*' || seg === rp[i]);
  }
}
