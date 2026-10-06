'use client';

import { useRouter } from 'next/navigation';
import { ReactNode, useEffect } from 'react';
import { useAuth } from './use-auth';
import { usePageReadyResource } from '../providers/page-ready-provider';
import { authenticatedHome, safeInternalPath } from '../lib/auth-routing';

export function OwnerGuard({ children }: { children: ReactNode }) {
  const router = useRouter(); const { session, profile, ownedArenas, isLoading, authDataError, refreshProfile } = useAuth();
  const authorized = Boolean(session && profile?.role === 'arena_owner' && ownedArenas.length > 0);
  usePageReadyResource('owner-access', !isLoading && (authorized || authDataError));
  useEffect(() => {
    if (isLoading || authDataError || authorized) return;
    if (!session) {
      const returnTo = safeInternalPath(`${window.location.pathname}${window.location.search}`) ?? '/dashboard';
      router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    router.replace(authenticatedHome(profile?.role, ownedArenas.length) ?? '/login');
  }, [authDataError, authorized, isLoading, ownedArenas.length, profile?.role, router, session]);
  if (isLoading) return null;
  if (authDataError) return <main className="mx-auto min-h-screen max-w-md px-4 pt-20 text-white"><h1 className="text-xl font-bold">Não foi possível carregar sua conta.</h1><button className="mt-4 min-h-11 font-bold text-[#8FFF3C]" onClick={() => void refreshProfile()} type="button">Tentar novamente</button></main>;
  if (!authorized) return null;
  return <>{children}</>;
}
