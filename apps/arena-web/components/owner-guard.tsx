'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { useAuth } from './use-auth';
import { LoadingPanel } from './loading-panel';

export function OwnerGuard({ children }: { children: ReactNode }) {
  const router = useRouter(); const { session, profile, ownedArenas, isLoading } = useAuth();
  useEffect(() => { if (isLoading) return; if (!session) router.replace('/login'); else if (profile?.role === 'player') router.replace('/player'); else if (profile?.role === 'arena_owner' && ownedArenas.length === 0) router.replace('/onboarding'); }, [isLoading, ownedArenas.length, profile?.role, router, session]);
  if (isLoading || !session || !profile || profile.role !== 'arena_owner' || ownedArenas.length === 0) return <LoadingPanel message="Verificando seu acesso..." />;
  return <>{children}</>;
}
