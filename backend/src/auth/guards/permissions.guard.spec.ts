import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from '../permissions.service';
import { Permission } from '../enums/permission.enum';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// ────────────────────────────── helpers ──────────────────────────────────────

function createMockContext(
  user?: { id: string; email: string; role: string } | null,
): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

// ─────────────────────────────── suite ───────────────────────────────────────

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: jest.Mocked<Reflector>;
  let permissionsService: jest.Mocked<PermissionsService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            getPermissionsForRole: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<PermissionsGuard>(PermissionsGuard);
    reflector = module.get(Reflector);
    permissionsService = module.get(PermissionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── 1. Public routes ────────────────────────────────────────────────
  describe('public routes (@Public decorator)', () => {
    it('should allow access to @Public() routes without any checks', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return true;
        return undefined;
      });

      const result = await guard.canActivate(createMockContext(null));

      expect(result).toBe(true);
      expect(permissionsService.getPermissionsForRole).not.toHaveBeenCalled();
    });
  });

  // ── 2. No required permissions ──────────────────────────────────────
  describe('routes without @RequirePermissions', () => {
    it('should allow access when no permissions are required', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY) return [];
        return undefined;
      });

      const result = await guard.canActivate(
        createMockContext({ id: '1', email: 'a@b.com', role: 'donor' }),
      );

      expect(result).toBe(true);
      expect(permissionsService.getPermissionsForRole).not.toHaveBeenCalled();
    });

    it('should allow access when @RequirePermissions is absent (undefined)', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY) return undefined;
        return undefined;
      });

      const result = await guard.canActivate(
        createMockContext({ id: '1', email: 'a@b.com', role: 'rider' }),
      );

      expect(result).toBe(true);
    });
  });

  // ── 3. User has all required permissions ────────────────────────────
  describe('user has all required permissions', () => {
    it('should allow access when user has the required permission', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY) return [Permission.VIEW_ORDER];
        return undefined;
      });

      permissionsService.getPermissionsForRole.mockResolvedValue([
        Permission.VIEW_ORDER,
        Permission.CREATE_ORDER,
      ]);

      const result = await guard.canActivate(
        createMockContext({ id: '1', email: 'a@b.com', role: 'hospital' }),
      );

      expect(result).toBe(true);
      expect(permissionsService.getPermissionsForRole).toHaveBeenCalledWith(
        'hospital',
      );
    });

    it('should allow access when user has ALL of multiple required permissions', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY)
          return [Permission.VIEW_ORDER, Permission.UPDATE_ORDER];
        return undefined;
      });

      permissionsService.getPermissionsForRole.mockResolvedValue([
        Permission.VIEW_ORDER,
        Permission.UPDATE_ORDER,
        Permission.CANCEL_ORDER,
      ]);

      const result = await guard.canActivate(
        createMockContext({ id: '2', email: 'b@c.com', role: 'admin' }),
      );

      expect(result).toBe(true);
    });
  });

  // ── 4. User is missing a permission ─────────────────────────────────
  describe('user lacks a required permission', () => {
    it('should throw ForbiddenException when user is missing one permission', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY) return [Permission.DELETE_ORDER];
        return undefined;
      });

      permissionsService.getPermissionsForRole.mockResolvedValue([
        Permission.VIEW_ORDER,
      ]);

      await expect(
        guard.canActivate(
          createMockContext({ id: '3', email: 'c@d.com', role: 'donor' }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should include requiredPermission in 403 response body', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY) return [Permission.MANAGE_RIDERS];
        return undefined;
      });

      permissionsService.getPermissionsForRole.mockResolvedValue([
        Permission.VIEW_ORDER,
      ]);

      try {
        await guard.canActivate(
          createMockContext({ id: '4', email: 'd@e.com', role: 'donor' }),
        );
        fail('Expected ForbiddenException to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        const response = (error as ForbiddenException).getResponse() as Record<
          string,
          unknown
        >;
        expect(response.requiredPermission).toBe(Permission.MANAGE_RIDERS);
        expect(response.requiredPermissions).toContain(Permission.MANAGE_RIDERS);
        expect(response.statusCode).toBe(403);
      }
    });

    it('should report multiple missing permissions in 403 body', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY)
          return [Permission.MANAGE_RIDERS, Permission.DELETE_ORDER];
        return undefined;
      });

      permissionsService.getPermissionsForRole.mockResolvedValue([]);

      try {
        await guard.canActivate(
          createMockContext({ id: '5', email: 'e@f.com', role: 'donor' }),
        );
        fail('Expected ForbiddenException');
      } catch (error) {
        const response = (error as ForbiddenException).getResponse() as Record<
          string,
          unknown
        >;
        expect(
          (response.requiredPermissions as string[]).length,
        ).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // ── 5. Missing role in user object ──────────────────────────────────
  describe('edge case: missing role', () => {
    it('should throw ForbiddenException when user has no role property', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY) return [Permission.VIEW_ORDER];
        return undefined;
      });

      // User object without a role
      const ctx = createMockContext({
        id: '6',
        email: 'f@g.com',
        role: '',
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException when request.user is null', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY) return [Permission.VIEW_ORDER];
        return undefined;
      });

      await expect(guard.canActivate(createMockContext(null))).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should throw ForbiddenException when request.user is undefined', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY) return [Permission.VIEW_ORDER];
        return undefined;
      });

      await expect(
        guard.canActivate(createMockContext(undefined)),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── 6. Role has NO permissions in DB ────────────────────────────────
  describe('edge case: role with zero permissions', () => {
    it('should throw ForbiddenException when role has no permissions in DB', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY) return [Permission.VIEW_ORDER];
        return undefined;
      });

      permissionsService.getPermissionsForRole.mockResolvedValue([]);

      await expect(
        guard.canActivate(
          createMockContext({ id: '7', email: 'g@h.com', role: 'unknown_role' }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── 7. Admin bypass ─────────────────────────────────────────────────
  describe('admin role', () => {
    it('should allow admin with ADMIN_ACCESS to access any protected route', async () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        if (key === PERMISSIONS_KEY) return [Permission.ADMIN_ACCESS];
        return undefined;
      });

      permissionsService.getPermissionsForRole.mockResolvedValue([
        Permission.ADMIN_ACCESS,
        Permission.MANAGE_ROLES,
        Permission.DELETE_ORDER,
      ]);

      const result = await guard.canActivate(
        createMockContext({ id: '8', email: 'admin@app.com', role: 'admin' }),
      );

      expect(result).toBe(true);
    });
  });
});
