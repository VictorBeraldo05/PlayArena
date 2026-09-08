'use client';

import { FormEvent, Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { PlayerBottomNav as PlayerNavigation } from '../../../components/player-bottom-nav';
import { useAuth } from '../../../components/use-auth';

export default function PlayerProfilePage() {
  return <Suspense fallback={<main className="min-h-[100dvh] bg-[#080D14]" />}><PlayerProfileContent /></Suspense>;
}

function PlayerProfileContent() {
  const { profile, session, signOut, updatePlayerProfile, errorMessage, clearError } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = params.get('returnTo');
  const safeReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    clearError();
    try {
      const saved = await updatePlayerProfile({ fullName: visibleName, phone: visiblePhone });
      if (saved && safeReturnTo) router.replace(safeReturnTo);
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (busy) return;
    setBusy(true);
    await signOut();
    router.replace('/login');
  }

  const visibleName = name || profile?.full_name || '';
  const visiblePhone = phone || profile?.phone || '';
  return <AppShell eyebrow="Conta" title="Seu perfil" subtitle="Mantenha seus dados atualizados."><PlayerNavigation /><form className="rounded-[18px] bg-[#111923] p-6" onSubmit={save}><label className="block text-sm font-bold">Nome completo<input className="mt-2" onChange={(event) => setName(event.target.value)} required value={visibleName} /></label><label className="mt-4 block text-sm font-bold">WhatsApp<input className="mt-2" inputMode="tel" onChange={(event) => setPhone(event.target.value)} required value={visiblePhone} /></label><p className="mt-4 text-sm text-[#9DA7B3]">{session?.user.email}</p>{errorMessage ? <p className="mt-4 rounded-xl bg-[#FF4B4B]/10 p-3 text-sm text-[#FFB3B3]">Não foi possível salvar seus dados.</p> : null}<button className="button mt-6 w-full" disabled={busy}>{busy ? 'Salvando...' : 'Salvar dados'}</button></form><button className="mt-5 min-h-[52px] w-full rounded-xl border border-[#FF4B4B]/50 text-sm font-bold text-[#FF4B4B] disabled:opacity-60" disabled={busy} onClick={() => void leave()}>{busy ? 'Saindo...' : 'Sair da conta'}</button></AppShell>;
}
