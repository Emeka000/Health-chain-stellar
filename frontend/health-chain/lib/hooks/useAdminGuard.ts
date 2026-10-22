/**
 * useAdminGuard
 *
 * Client-side second layer of defence for admin routes.
 * The middleware already redirects at the edge; this hook
 * provides an additional check inside admin page components
 * so that even if the middleware is bypassed the component
 * can redirect before rendering sensitive UI.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/auth.store';

const ADMIN_ROLES = ['admin', 'super_admin'];

export function useAdminGuard(): { isAdmin: boolean } {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const isAdmin = isAuthenticated && !!user?.role && ADMIN_ROLES.includes(user.role);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isAdmin, router]);

  return { isAdmin };
}
