'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { AppShell } from '../../components/app-shell';
import { LoadingPanel } from '../../components/loading-panel';
import { OnboardingForm } from '../../components/onboarding-form';
import { OwnerUpgradePanel } from '../../components/owner-upgrade-panel';
import { useAuth } from '../../components/use-auth';

export default function OnboardingPage() {
  const router = useRouter();
  const { session, profile, ownedArenas, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && !session) {
      router.replace('/login');
      return;
    }

    if (!isLoading && profile?.role === 'arena_owner' && ownedArenas.length > 0) {
      router.replace('/dashboard');
    }
  }, [isLoading, ownedArenas.length, profile?.role, router, session]);

  return (
    <AppShell
      eyebrow="Onboarding"
      subtitle="Primeiro passo operacional para o proprietario criar sua arena sem expor service role no navegador."
      title="Configure sua primeira arena"
    >
      {isLoading ? <LoadingPanel message="Confirmando permissao e carregando seu profile..." /> : null}
      {!isLoading && session && profile?.role === 'player' ? <OwnerUpgradePanel /> : null}
      {!isLoading && session && profile?.role === 'arena_owner' && ownedArenas.length === 0 ? (
        <OnboardingForm />
      ) : null}
    </AppShell>
  );
}
