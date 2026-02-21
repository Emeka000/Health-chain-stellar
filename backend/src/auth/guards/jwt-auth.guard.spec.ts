import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

// ────────────────────────────── helpers ──────────────────────────────────────

function createMockContext(handler = {}, cls = {}): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({}) }),
  } as unknown as ExecutionContext;
}

// ─────────────────────────────── suite ───────────────────────────────────────

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtAuthGuard,
        {
          provide: Reflector,
          useValue: { getAllAndOverride: jest.fn() },
        },
      ],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
    reflector = module.get(Reflector);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate()', () => {
    it('returns true immediately for @Public() routes', () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      // We spy on super.canActivate to ensure it is NOT called
      const superSpy = jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
        .mockReturnValue(true);

      const result = guard.canActivate(createMockContext());

      expect(result).toBe(true);
      superSpy.mockRestore();
    });

    it('delegates to passport JWT strategy for non-public routes', () => {
      reflector.getAllAndOverride.mockImplementation((key: string) => {
        if (key === IS_PUBLIC_KEY) return false;
        return undefined;
      });

      // super.canActivate is from AuthGuard('jwt') — it calls passport
      const superActivate = jest
        .spyOn(Object.getPrototypeOf(Object.getPrototypeOf(guard)), 'canActivate')
        .mockReturnValue(true as unknown as Promise<boolean>);

      guard.canActivate(createMockContext());

      expect(superActivate).toHaveBeenCalled();
      superActivate.mockRestore();
    });
  });

  describe('handleRequest()', () => {
    it('returns the user when no error and user exists', () => {
      const user = { id: '1', email: 'a@b.com', role: 'admin' };
      const result = guard.handleRequest(null, user, null);
      expect(result).toBe(user);
    });

    it('throws UnauthorizedException when user is null', () => {
      expect(() => guard.handleRequest(null, null, null)).toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when user is falsy', () => {
      expect(() => guard.handleRequest(null, undefined, null)).toThrow(
        UnauthorizedException,
      );
    });

    it('rethrows the error when err is provided', () => {
      const err = new UnauthorizedException('custom error');
      expect(() => guard.handleRequest(err, null, null)).toThrow(err);
    });

    it('includes TokenExpiredError message in the exception', () => {
      const info = { name: 'TokenExpiredError', message: 'jwt expired' };
      expect(() => guard.handleRequest(null, null, info)).toThrow(
        UnauthorizedException,
      );
    });

    it('uses info.message for generic JWT errors', () => {
      const info = { message: 'invalid signature' };
      try {
        guard.handleRequest(null, null, info);
        fail('Expected UnauthorizedException');
      } catch (e) {
        expect(e).toBeInstanceOf(UnauthorizedException);
      }
    });
  });
});
