'use client';

import { OwnerGuard } from '../../components/owner-guard';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <OwnerGuard>{children}</OwnerGuard>;
}
