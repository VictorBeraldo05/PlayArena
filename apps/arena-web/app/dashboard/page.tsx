'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { ManagementDashboard } from '../../components/management-dashboard';
import { OwnerNavigation } from '../../components/owner-navigation';
import { OwnerGuard } from '../../components/owner-guard';
import { useAuth } from '../../components/use-auth';

export default function DashboardPage() {
  const router = useRouter();
  const { session, profile, ownedArenas, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace('/login');
      return;
    }

    if (!isLoading && profile?.role === 'arena_owner' && ownedArenas.length === 0) {
      router.replace('/onboarding');
    }
  }, [isLoading, ownedArenas.length, profile?.role, router, session]);

  return <main className="min-h-screen px-4 pb-4 pt-6 md:px-8 md:pt-8"><OwnerGuard><ManagementDashboard/><OwnerNavigation/></OwnerGuard></main>;
}
