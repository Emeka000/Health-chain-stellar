/**
 * Negative authorization tests for fine-grained permission scopes (Issue #374).
 *
 * Verifies that sensitive actions are blocked when the caller lacks the
 * required scope, even if they hold a valid role.
 */
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';

import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Permission } from '../enums/permission.enum';
import { PermissionsService } from '../permissions.service';
import { PermissionsGuard } from './permissions.guard';

function makeContext(role: string): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 'u1', email: 'u@test.com', role } }),
    }),
  } as unknown as ExecutionContext;
}

describe('Fine-grained permission scopes – negative authorization (Issue #374)', () => {
  let guard: PermissionsGuard;
  let reflector: jest.Mocked<Reflector>;
  let permissionsService: jest.Mocked<PermissionsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn() },
        },
        {
          provide: PermissionsService,
          useValue: { getPermissionsForRole: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get(PermissionsGuard);
    reflector = module.get(Reflector);
    permissionsService = module.get(PermissionsService);

    // Default: not public
    reflector.getAllAndOverride.mockImplementation((key) =>
      key === IS_PUBLIC_KEY ? false : undefined,
    );
  });

  function setupRequired(scope: Permission, rolePermissions: Permission[]) {
    reflector.getAllAndOverride.mockImplementation((key) => {
      if (key === IS_PUBLIC_KEY) return false;
      if (key === PERMISSIONS_KEY) return [scope];
      return undefined;
    });
    permissionsService.getPermissionsForRole.mockResolvedValue(rolePermissions);
  }

  it('blocks inventory:write for a donor role', async () => {
    setupRequired(Permission.INVENTORY_WRITE, [Permission.VIEW_INVENTORY]);
    await expect(guard.canActivate(makeContext('donor'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks dispatch:override for a hospital role', async () => {
    setupRequired(Permission.DISPATCH_OVERRIDE, [
      Permission.VIEW_DISPATCH,
      Permission.CREATE_DISPATCH,
    ]);
    await expect(guard.canActivate(makeContext('hospital'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks request:approve for a rider role', async () => {
    setupRequired(Permission.REQUEST_APPROVE, [
      Permission.VIEW_ORDER,
      Permission.UPDATE_ORDER,
    ]);
    await expect(guard.canActivate(makeContext('rider'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks dispute:resolve for a donor role', async () => {
    setupRequired(Permission.DISPUTE_RESOLVE, [Permission.VIEW_ORDER]);
    await expect(guard.canActivate(makeContext('donor'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks verification:admin for a vendor role', async () => {
    setupRequired(Permission.VERIFICATION_ADMIN, [
      Permission.VIEW_INVENTORY,
      Permission.INVENTORY_WRITE,
    ]);
    await expect(guard.canActivate(makeContext('vendor'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('blocks settlement:release for a hospital role', async () => {
    setupRequired(Permission.SETTLEMENT_RELEASE, [
      Permission.VIEW_ORDER,
      Permission.REQUEST_APPROVE,
    ]);
    await expect(guard.canActivate(makeContext('hospital'))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows inventory:write when the scope is present', async () => {
    setupRequired(Permission.INVENTORY_WRITE, [
      Permission.VIEW_INVENTORY,
      Permission.INVENTORY_WRITE,
    ]);
    await expect(
      guard.canActivate(makeContext('vendor')),
    ).resolves.toBe(true);
  });

  it('allows dispute:resolve for admin role', async () => {
    setupRequired(Permission.DISPUTE_RESOLVE, [
      Permission.ADMIN_ACCESS,
      Permission.DISPUTE_RESOLVE,
    ]);
    await expect(guard.canActivate(makeContext('admin'))).resolves.toBe(true);
  });
});
