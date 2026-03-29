import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';

const intlMiddleware = createMiddleware(routing);

// Routes that require authentication
const PROTECTED_ROUTES = ['/dashboard'];
// Routes that should redirect to dashboard if already authenticated
const AUTH_ROUTES = ['/auth/signin', '/auth/signup'];
// Routes always publicly accessible
const PUBLIC_ROUTES = ['/transparency'];

export default function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // 1. Run i18n middleware first to get the locale
  const response = intlMiddleware(request);
  
  // 2. Auth logic
  const authCookie = request.cookies.get('auth-storage');
  let isAuthenticated = false;
  if (authCookie) {
    try {
      const authState = JSON.parse(authCookie.value);
      isAuthenticated = authState?.state?.isAuthenticated === true;
    } catch {
      isAuthenticated = false;
    }
  }

  // Remove locale prefix for routing checks
  const pathWithoutLocale = pathname.replace(/^\/(en|fr)/, '') || '/';

  const isProtectedRoute = PROTECTED_ROUTES.some((route) => pathWithoutLocale.startsWith(route));
  const isAuthRoute = AUTH_ROUTES.some((route) => pathWithoutLocale.startsWith(route));
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathWithoutLocale.startsWith(route));

  if (isPublicRoute) return response;

  if (isProtectedRoute && !isAuthenticated) {
    const locale = pathname.split('/')[1] || 'en';
    const loginUrl = new URL(`/${locale}/auth/signin`, request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthRoute && isAuthenticated) {
    const locale = pathname.split('/')[1] || 'en';
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url));
  }

  return response;
}

export const config = {
  matcher: ['/', '/(en|fr)/:path*', '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|api).*)']
};
