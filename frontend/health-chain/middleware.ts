/**
 * Next.js Middleware for server-side route protection
 * Checks auth state and redirects unauthenticated users.
 * Enforces role-based access control on /admin routes.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require authentication
const PROTECTED_ROUTES = ['/dashboard', '/admin'];

// Routes that should redirect to dashboard if already authenticated
const AUTH_ROUTES = ['/auth/signin', '/auth/signup'];

// Routes always publicly accessible — never redirect
const PUBLIC_ROUTES = ['/transparency'];

const ADMIN_ROLES = ['admin', 'super_admin'];

/**
 * Decode the JWT payload (base64url) without verifying the signature.
 * Signature verification happens on the backend; middleware only reads the claim
 * to decide routing — the backend enforces actual authorisation.
 */
function getTokenRole(req: NextRequest): string | null {
  const authCookie = req.cookies.get('auth-storage');
  if (!authCookie) return null;
  try {
    const authState = JSON.parse(authCookie.value);
    const token: string | null = authState?.state?.accessToken ?? null;
    if (!token) return null;
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) return null;
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')));
    return (payload?.role as string) ?? null;
  } catch {
    return null;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Get auth token from cookie or session storage (via header)
  const authCookie = request.cookies.get('auth-storage');
  
  // Parse auth state from cookie
  let isAuthenticated = false;
  
  if (authCookie) {
    try {
      const authState = JSON.parse(authCookie.value);
      isAuthenticated = authState?.state?.isAuthenticated === true;
    } catch {
      // Invalid cookie, treat as unauthenticated
      isAuthenticated = false;
    }
  }

  // Check if current route is protected
  const isProtectedRoute = PROTECTED_ROUTES.some((route) =>
    pathname.startsWith(route)
  );

  // Check if current route is an auth route
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));

  // Never redirect public transparency routes
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
  if (isPublicRoute) return NextResponse.next();

  // Redirect unauthenticated users from protected routes
  if (isProtectedRoute && !isAuthenticated) {
    const url = new URL('/auth/signin', request.url);
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  // Role-based guard: /admin is restricted to admin roles only
  if (pathname.startsWith('/admin')) {
    const role = getTokenRole(request);
    if (!role || !ADMIN_ROLES.includes(role)) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Redirect authenticated users from auth routes to dashboard
  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api routes
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|api).*)',
  ],
};
