import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AdminGuard } from '../guards/admin.guard';
import { AdminScope } from '../enums/admin-scope.enum';
import { ADMIN_SCOPE_KEY } from '../decorators/require-admin-scope.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';

const mockJwtService = {
  verify: jest.fn(),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('test-secret'),
};

const mockReflector = {
  getAllAndOverride: jest.fn(),
};

function buildContext(authHeader?: string, scope?: AdminScope): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: { authorization: authHeader },
        method: 'GET',
        path: '/blockchain/queue/status',
        ip: '127.0.0.1',
      }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  let guard: AdminGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new AdminGuard(
      mockJwtService as unknown as JwtService,
      mockConfigService as unknown as ConfigService,
      mockReflector as unknown as Reflector,
    );
    // Default: no scope required
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
  });

  // ── 401: missing token ─────────────────────────────────────────────────────

  it('should throw 401 when Authorization header is missing', async () => {
    const ctx = buildContext(undefined);
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw 401 when Authorization header does not start with Bearer', async () => {
    const ctx = buildContext('Basic sometoken');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  // ── 401: invalid / expired token ───────────────────────────────────────────

  it('should throw 401 when JWT is invalid', async () => {
    mockJwtService.verify.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const ctx = buildContext('Bearer badtoken');
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('should throw 401 with expiry message when token is expired', async () => {
    const err: any = new Error('jwt expired');
    err.name = 'TokenExpiredError';
    mockJwtService.verify.mockImplementation(() => { throw err; });
    const ctx = buildContext('Bearer expiredtoken');
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new UnauthorizedException('Token has expired. Please re-authenticate.'),
    );
  });

  // ── 403: valid token but wrong role ────────────────────────────────────────

  it('should throw 403 when user is not an admin', async () => {
    mockJwtService.verify.mockReturnValue({
      sub: 'user-1',
      email: 'donor@example.com',
      role: UserRole.DONOR,
    });
    const ctx = buildContext('Bearer validtoken');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should throw 403 when user has hospital role', async () => {
    mockJwtService.verify.mockReturnValue({
      sub: 'user-2',
      email: 'hospital@example.com',
      role: UserRole.HOSPITAL,
    });
    const ctx = buildContext('Bearer validtoken');
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  // ── 200: valid admin token ─────────────────────────────────────────────────

  it('should allow access when user has admin role and no scope is required', async () => {
    mockJwtService.verify.mockReturnValue({
      sub: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    });
    const ctx = buildContext('Bearer admintoken');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  // ── scope checks ───────────────────────────────────────────────────────────

  it('should allow admin access to READ_METRICS scope', async () => {
    mockJwtService.verify.mockReturnValue({
      sub: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    });
    mockReflector.getAllAndOverride.mockReturnValue(AdminScope.READ_METRICS);
    const ctx = buildContext('Bearer admintoken');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should allow admin access to MANAGE_DLQ scope', async () => {
    mockJwtService.verify.mockReturnValue({
      sub: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    });
    mockReflector.getAllAndOverride.mockReturnValue(AdminScope.MANAGE_DLQ);
    const ctx = buildContext('Bearer admintoken');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('should attach user info to the request object on success', async () => {
    const fakeRequest: any = {
      headers: { authorization: 'Bearer admintoken' },
      method: 'GET',
      path: '/blockchain/queue/status',
      ip: '127.0.0.1',
    };
    mockJwtService.verify.mockReturnValue({
      sub: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    });
    const ctx: ExecutionContext = {
      switchToHttp: () => ({ getRequest: () => fakeRequest }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as unknown as ExecutionContext;

    await guard.canActivate(ctx);

    expect(fakeRequest.user).toMatchObject({
      id: 'admin-1',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
    });
  });
});
