import { describe, it, expect } from 'vitest';

// ── Middleware logic extracted from frontend/health-chain/middleware.ts ────────

const PROTECTED_ROUTES = ['/dashboard'];
const AUTH_ROUTES = ['/auth/signin', '/auth/signup'];
const PUBLIC_ROUTES = ['/transparency'];

function parseAuthState(cookieValue: string | null): boolean {
  if (!cookieValue) return false;
  try {
    const authState = JSON.parse(cookieValue);
    return authState?.state?.isAuthenticated === true;
  } catch {
    return false;
  }
}

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some((route) => pathname.startsWith(route));
}

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => pathname.startsWith(route));
}

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
}

type MiddlewareAction =
  | { action: 'next' }
  | { action: 'redirect'; to: string };

function resolveMiddlewareAction(
  pathname: string,
  cookieValue: string | null,
): MiddlewareAction {
  if (isPublicRoute(pathname)) return { action: 'next' };

  const isAuthenticated = parseAuthState(cookieValue);

  if (isProtectedRoute(pathname) && !isAuthenticated) {
    return { action: 'redirect', to: `/auth/signin?redirect=${pathname}` };
  }

  if (isAuthRoute(pathname) && isAuthenticated) {
    return { action: 'redirect', to: '/dashboard' };
  }

  return { action: 'next' };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AuthGuard (Next.js middleware) route protection logic', () => {
  describe('parseAuthState', () => {
    it('returns true for a valid authenticated cookie', () => {
      const cookie = JSON.stringify({ state: { isAuthenticated: true } });
      expect(parseAuthState(cookie)).toBe(true);
    });

    it('returns false for a valid unauthenticated cookie', () => {
      const cookie = JSON.stringify({ state: { isAuthenticated: false } });
      expect(parseAuthState(cookie)).toBe(false);
    });

    it('returns false for null cookie (no auth-storage cookie)', () => {
      expect(parseAuthState(null)).toBe(false);
    });

    it('returns false for a malformed JSON cookie', () => {
      expect(parseAuthState('not-json')).toBe(false);
    });

    it('returns false when isAuthenticated key is missing', () => {
      const cookie = JSON.stringify({ state: {} });
      expect(parseAuthState(cookie)).toBe(false);
    });
  });

  describe('isProtectedRoute', () => {
    it('identifies /dashboard as protected', () => {
      expect(isProtectedRoute('/dashboard')).toBe(true);
    });

    it('identifies /dashboard/orders as protected (prefix match)', () => {
      expect(isProtectedRoute('/dashboard/orders')).toBe(true);
    });

    it('does not mark /auth/signin as protected', () => {
      expect(isProtectedRoute('/auth/signin')).toBe(false);
    });

    it('does not mark the home page as protected', () => {
      expect(isProtectedRoute('/')).toBe(false);
    });
  });

  describe('resolveMiddlewareAction – unauthenticated users', () => {
    const unauthCookie = null;

    it('redirects unauthenticated users away from /dashboard to /auth/login', () => {
      const result = resolveMiddlewareAction('/dashboard', unauthCookie);
      expect(result.action).toBe('redirect');
      if (result.action === 'redirect') {
        expect(result.to).toContain('/auth/signin');
      }
    });

    it('preserves the original pathname as redirect query param', () => {
      const result = resolveMiddlewareAction('/dashboard/orders', unauthCookie);
      expect(result.action).toBe('redirect');
      if (result.action === 'redirect') {
        expect(result.to).toContain('redirect=/dashboard/orders');
      }
    });

    it('allows unauthenticated users to access /auth/signin', () => {
      const result = resolveMiddlewareAction('/auth/signin', unauthCookie);
      expect(result.action).toBe('next');
    });
  });

  describe('resolveMiddlewareAction – authenticated users', () => {
    const authCookie = JSON.stringify({ state: { isAuthenticated: true } });

    it('redirects authenticated users from /auth/signin to /dashboard', () => {
      const result = resolveMiddlewareAction('/auth/signin', authCookie);
      expect(result.action).toBe('redirect');
      if (result.action === 'redirect') {
        expect(result.to).toBe('/dashboard');
      }
    });

    it('redirects authenticated users from /auth/signup to /dashboard', () => {
      const result = resolveMiddlewareAction('/auth/signup', authCookie);
      expect(result.action).toBe('redirect');
      if (result.action === 'redirect') {
        expect(result.to).toBe('/dashboard');
      }
    });

    it('allows authenticated users to access /dashboard', () => {
      const result = resolveMiddlewareAction('/dashboard', authCookie);
      expect(result.action).toBe('next');
    });
  });

  describe('resolveMiddlewareAction – public routes', () => {
    it('always allows access to /transparency regardless of auth state', () => {
      expect(resolveMiddlewareAction('/transparency', null).action).toBe('next');
      const authCookie = JSON.stringify({ state: { isAuthenticated: true } });
      expect(resolveMiddlewareAction('/transparency', authCookie).action).toBe('next');
    });

    it('allows access to /transparency sub-paths', () => {
      const result = resolveMiddlewareAction('/transparency/metrics', null);
      expect(result.action).toBe('next');
    });
  });
});
