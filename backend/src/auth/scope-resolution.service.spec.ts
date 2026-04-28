import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { RoleEntity } from './entities/role.entity';
import { ScopeResolutionService } from './scope-resolution.service';
import { ScopeEvaluationContext, ScopeGrant } from './scope-resolution.types';

const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  setex: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
};

const mockRoleRepo = {
  findOne: jest.fn(),
};

const makeCtx = (overrides: Partial<ScopeEvaluationContext> = {}): ScopeEvaluationContext => ({
  userId: 'user-1',
  role: 'admin',
  orgId: 'org-1',
  ...overrides,
});

const makeGrant = (scope: string, effect: 'ALLOW' | 'DENY', inherited = false, orgId: string | null = null): ScopeGrant => ({
  scope,
  effect,
  orgId,
  inherited,
});

describe('ScopeResolutionService (Issue #619)', () => {
  let service: ScopeResolutionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRoleRepo.findOne.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScopeResolutionService,
        { provide: getRepositoryToken(RoleEntity), useValue: mockRoleRepo },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    service = module.get(ScopeResolutionService);
  });

  // ── Default DENY ──────────────────────────────────────────────────────────

  it('denies when no grants match', async () => {
    const decision = await service.evaluate('create:order', makeCtx());
    expect(decision.allowed).toBe(false);
    expect(decision.trace[0].reason).toMatch(/default DENY/);
  });

  // ── Explicit ALLOW ────────────────────────────────────────────────────────

  it('allows with explicit ALLOW grant', async () => {
    const ctx = makeCtx({ extraGrants: [makeGrant('create:order', 'ALLOW')] });
    const decision = await service.evaluate('create:order', ctx);
    expect(decision.allowed).toBe(true);
    expect(decision.trace[0].effect).toBe('ALLOW');
  });

  // ── Explicit DENY wins over ALLOW ─────────────────────────────────────────

  it('explicit DENY wins over explicit ALLOW (precedence rule 1)', async () => {
    const ctx = makeCtx({
      extraGrants: [
        makeGrant('create:order', 'ALLOW'),
        makeGrant('create:order', 'DENY'),
      ],
    });
    const decision = await service.evaluate('create:order', ctx);
    expect(decision.allowed).toBe(false);
    expect(decision.trace[0].effect).toBe('DENY');
  });

  // ── Inherited ALLOW ───────────────────────────────────────────────────────

  it('inherited ALLOW grants access when no explicit grant exists', async () => {
    const ctx = makeCtx({ extraGrants: [makeGrant('view:order', 'ALLOW', true)] });
    const decision = await service.evaluate('view:order', ctx);
    expect(decision.allowed).toBe(true);
    expect(decision.trace[0].reason).toMatch(/Inherited ALLOW/);
  });

  it('explicit ALLOW wins over inherited ALLOW (precedence rule 2)', async () => {
    const ctx = makeCtx({
      extraGrants: [
        makeGrant('view:order', 'ALLOW', true),   // inherited
        makeGrant('view:order', 'ALLOW', false),  // explicit
      ],
    });
    const decision = await service.evaluate('view:order', ctx);
    expect(decision.allowed).toBe(true);
    expect(decision.trace[0].reason).toMatch(/Explicit ALLOW/);
  });

  // ── Wildcard matching ─────────────────────────────────────────────────────

  it('wildcard scope "view:*" matches "view:order"', async () => {
    const ctx = makeCtx({ extraGrants: [makeGrant('view:*', 'ALLOW')] });
    const decision = await service.evaluate('view:order', ctx);
    expect(decision.allowed).toBe(true);
  });

  it('wildcard scope "*:*" matches any scope', async () => {
    const ctx = makeCtx({ extraGrants: [makeGrant('*:*', 'ALLOW')] });
    const decision = await service.evaluate('delete:user', ctx);
    expect(decision.allowed).toBe(true);
  });

  it('wildcard "*" matches any scope', async () => {
    const ctx = makeCtx({ extraGrants: [makeGrant('*', 'ALLOW')] });
    const decision = await service.evaluate('create:order', ctx);
    expect(decision.allowed).toBe(true);
  });

  it('wildcard "view:*" does NOT match "create:order"', async () => {
    const ctx = makeCtx({ extraGrants: [makeGrant('view:*', 'ALLOW')] });
    const decision = await service.evaluate('create:order', ctx);
    expect(decision.allowed).toBe(false);
  });

  // ── Org-boundary enforcement ──────────────────────────────────────────────

  it('org-scoped grant applies when orgId matches', async () => {
    const ctx = makeCtx({
      orgId: 'org-1',
      extraGrants: [makeGrant('view:order', 'ALLOW', false, 'org-1')],
    });
    const decision = await service.evaluate('view:order', ctx);
    expect(decision.allowed).toBe(true);
  });

  it('org-scoped grant is filtered out when orgId does not match (cross-org leakage prevention)', async () => {
    const ctx = makeCtx({
      orgId: 'org-2',
      extraGrants: [makeGrant('view:order', 'ALLOW', false, 'org-1')],
    });
    const decision = await service.evaluate('view:order', ctx);
    expect(decision.allowed).toBe(false);
  });

  it('global grant (orgId=null) applies regardless of context orgId', async () => {
    const ctx = makeCtx({
      orgId: 'org-99',
      extraGrants: [makeGrant('view:order', 'ALLOW', false, null)],
    });
    const decision = await service.evaluate('view:order', ctx);
    expect(decision.allowed).toBe(true);
  });

  // ── assertScope ───────────────────────────────────────────────────────────

  it('assertScope does not throw when allowed', async () => {
    const ctx = makeCtx({ extraGrants: [makeGrant('create:order', 'ALLOW')] });
    await expect(service.assertScope('create:order', ctx)).resolves.not.toThrow();
  });

  it('assertScope throws ForbiddenException when denied', async () => {
    await expect(service.assertScope('create:order', makeCtx())).rejects.toThrow(
      ForbiddenException,
    );
  });

  // ── Cache invalidation ────────────────────────────────────────────────────

  it('invalidateScopeCache calls redis.del with correct key', async () => {
    await service.invalidateScopeCache('admin');
    expect(mockRedis.del).toHaveBeenCalledWith('scope:grants:admin');
  });

  // ── Decision trace ────────────────────────────────────────────────────────

  it('decision trace contains matched grant and reason', async () => {
    const ctx = makeCtx({ extraGrants: [makeGrant('create:order', 'ALLOW')] });
    const decision = await service.evaluate('create:order', ctx);
    expect(decision.trace).toHaveLength(1);
    expect(decision.trace[0].matchedGrant.scope).toBe('create:order');
    expect(decision.trace[0].reason).toBeTruthy();
  });

  // ── Role-based grants from DB ─────────────────────────────────────────────

  it('loads grants from role entity permissions', async () => {
    mockRoleRepo.findOne.mockResolvedValue({
      name: 'admin',
      permissions: [{ permission: 'view:order' }],
    });
    const ctx = makeCtx({ role: 'admin', extraGrants: [] });
    const decision = await service.evaluate('view:order', ctx);
    expect(decision.allowed).toBe(true);
  });

  it('uses cached grants on second call', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify([{ scope: 'view:order', effect: 'ALLOW', orgId: null, inherited: false }]));
    const ctx = makeCtx({ role: 'admin', extraGrants: [] });
    const decision = await service.evaluate('view:order', ctx);
    expect(decision.allowed).toBe(true);
    expect(mockRoleRepo.findOne).not.toHaveBeenCalled();
  });
});
