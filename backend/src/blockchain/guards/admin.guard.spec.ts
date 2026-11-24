import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminGuard } from './admin.guard';
import { ADMIN_SCOPE_KEY } from '../decorators/admin-scope.decorator';

function buildContext(user: unknown): { context: ExecutionContext; request: any } {
  const request: any = { user };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, request };
}

function buildReflector(requiredScope?: string): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(requiredScope),
  } as unknown as Reflector;
}

describe('AdminGuard', () => {
  it('allows an admin user and preserves req.user (sid, organizationId)', () => {
    const guard = new AdminGuard(buildReflector());
    const user = {
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
      sid: 'session-123',
      organizationId: 'org-1',
    };
    const { context, request } = buildContext(user);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toBe(user);
    expect(request.user.sid).toBe('session-123');
    expect(request.user.organizationId).toBe('org-1');
  });

  it('does not re-verify the Authorization header (relies on req.user)', () => {
    const guard = new AdminGuard(buildReflector());
    const user = { id: 'admin-1', role: 'admin', sid: 'session-123' };
    const { context, request } = buildContext(user);
    request.headers = { authorization: 'Bearer token-signed-with-previous-key' };

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toBe(user);
  });

  it('rejects when req.user is missing', () => {
    const guard = new AdminGuard(buildReflector());
    const { context } = buildContext(undefined);

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects non-admin users', () => {
    const guard = new AdminGuard(buildReflector());
    const { context } = buildContext({ id: 'u1', role: 'user', sid: 's1' });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('enforces the required admin scope', () => {
    const guard = new AdminGuard(buildReflector('blockchain:admin'));
    const { context } = buildContext({ id: 'admin-1', role: 'admin', scopes: [] });

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows an admin with the required scope', () => {
    const guard = new AdminGuard(buildReflector('blockchain:admin'));
    const user = { id: 'admin-1', role: 'admin', scopes: ['blockchain:admin'] };
    const { context, request } = buildContext(user);

    expect(guard.canActivate(context)).toBe(true);
    expect(request.user).toBe(user);
  });
});
