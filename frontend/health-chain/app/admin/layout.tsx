'use client';

import React from 'react';
import { useAdminGuard } from '@/lib/hooks/useAdminGuard';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  useAdminGuard();

  return <>{children}</>;
}
