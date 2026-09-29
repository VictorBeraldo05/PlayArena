'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { PlayerBottomNav } from '../../../components/player-bottom-nav';
import { PwaInstallCard } from '../../../components/pwa-install-card';
import { useAuth } from '../../../components/use-auth';
import { apiRequest } from '../../../lib/api';
import { formatCurrencyBRL } from '../../../lib/format';

export default function PlayerProfilePage() {
  return <Suspense fallback={<main className="min-h-[100dvh] bg-[#080D14]" />}><PlayerProfileContent /></Suspense>;
}

function PlayerProfileContent() {
  const { profile, session, isLoading, signOut, updatePlayerProfile, errorMessage, clearError } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const returnTo = params.get('returnTo');
  const safeReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null;
  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftPhone, setDraftPhone] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [walletBalance, setWalletBalance] = useState<string | number | null>(null);

  useEffect(() => {
    if (!session) return;
    let active = true;
    void apiRequest<{ balance: string | number }>('/player/wallet', session.access_token, { cache: 'no-store' })
      .then((wallet) => { if (active) setWalletBalance(wallet.balance); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [session]);

  const profileNeedsCompletion = Boolean(session && !isLoading && (!profile?.full_name?.trim() || !profile?.phone?.trim()));
  const editing = isEditing || profileNeedsCompletion;
  const visibleName = draftName ?? profile?.full_name ?? '';
  const visiblePhone = draftPhone ?? formatPhone(profile?.phone ?? '');
  const phoneDigits = visiblePhone.replace(/\D/g, '');
  const canSave = visibleName.trim().length > 0 && (phoneDigits.length === 10 || phoneDigits.length === 11);
  const fullName = profile?.full_name?.trim() || 'Jogador PlayArena';
  const firstName = fullName.split(/\s+/)[0];
  const email = session?.user.email || 'E-mail indisponível';

  function startEditing() {
    setDraftName(profile?.full_name ?? '');
    setDraftPhone(formatPhone(profile?.phone ?? ''));
    clearError();
    setIsEditing(true);
  }

  function cancelEditing() {
    setDraftName(null);
    setDraftPhone(null);
    clearError();
    setIsEditing(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !canSave) return;
    setBusy(true);
    clearError();
    try {
      const saved = await updatePlayerProfile({ fullName: visibleName.trim(), phone: visiblePhone.trim() });
      if (saved) {
        setIsEditing(false);
        setDraftName(null);
        setDraftPhone(null);
        if (safeReturnTo) router.replace(safeReturnTo);
      }
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

  return (
    <main className="relative min-h-[100dvh] overflow-x-hidden bg-[#080D14] pb-[calc(7rem+env(safe-area-inset-bottom))] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[360px] bg-[radial-gradient(ellipse_at_78%_0%,rgba(143,255,60,.12),transparent_55%)]" />
      <div className="relative mx-auto w-full max-w-[620px] px-4 pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-6 sm:pt-10">
        <header className="mb-6">
          <p className="text-[11px] font-extrabold uppercase tracking-[.28em] text-[#8FFF3C]">Perfil</p>
          <h1 className="mt-2 text-[30px] font-black leading-[1.08] tracking-[-.055em] sm:text-[36px]">Olá, {firstName}<span className="text-[#8FFF3C]">.</span></h1>
          <p className="mt-2 text-[13px] text-[#9DA7B3]">Seu espaço no PlayArena</p>
        </header>

        <section aria-label="Sua conta" className="relative overflow-hidden rounded-[24px] border border-white/[.08] bg-[linear-gradient(145deg,#16241F_0%,#111923_48%,#0D151F_100%)] shadow-[0_22px_55px_rgba(0,0,0,.22)]">
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-52 w-52 rounded-full border border-[#8FFF3C]/10 shadow-[0_0_70px_18px_rgba(143,255,60,.08)]" />
          <div className="relative flex items-center gap-3.5 px-4 py-4 sm:px-5">
            <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-[18px] border border-[#8FFF3C]/30 bg-[#8FFF3C]/[.12] text-xl font-black tracking-[-.07em] text-[#8FFF3C] shadow-[inset_0_1px_0_rgba(255,255,255,.1)]">{initials(fullName)}</span>
            <div className="min-w-0"><h2 className="truncate text-[17px] font-extrabold tracking-[-.035em]">{fullName}</h2><p className="mt-0.5 truncate text-xs text-[#9DA7B3]">{email}</p></div>
          </div>
          <Link className="relative flex min-h-16 items-center justify-between gap-3 border-t border-white/[.08] px-4 py-3 transition-colors hover:bg-white/[.035] focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-[#8FFF3C] sm:px-5" href="/player/saldo">
            <span className="min-w-0"><span className="block text-[11px] font-bold uppercase tracking-[.12em] text-[#9DA7B3]">Saldo PlayArena</span><span className="mt-0.5 block text-[11px] font-semibold text-[#C3CDD7]">Ver movimentações <span aria-hidden="true">→</span></span></span>
            <strong className="shrink-0 whitespace-nowrap text-[20px] font-black tracking-[-.045em] text-[#8FFF3C]">{walletBalance === null ? '—' : formatCurrencyBRL(walletBalance)}</strong>
          </Link>
        </section>

        <section aria-labelledby="personal-details-title" className="mt-8">
          <div className="flex min-h-10 items-center justify-between gap-3">
            <h2 className="text-[11px] font-extrabold uppercase tracking-[.2em] text-[#9DA7B3]" id="personal-details-title">Dados pessoais</h2>
            {!editing ? <button className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2 text-xs font-bold text-[#8FFF3C] focus-visible:outline-2 focus-visible:outline-[#8FFF3C]" onClick={startEditing} type="button"><EditIcon /> Editar dados</button> : null}
          </div>
          {editing ? (
            <form className="mt-1 border-t border-white/[.08]" onSubmit={(event) => void save(event)}>
              <label className="mt-4 block text-[11px] font-semibold text-[#9DA7B3]" htmlFor="profile-name">Nome completo</label>
              <input autoComplete="name" className="mt-1.5 min-h-12 w-full rounded-xl border border-white/[.1] bg-[#18212D] px-3.5 text-sm font-semibold text-white outline-none transition focus:border-[#8FFF3C]/70 focus:ring-2 focus:ring-[#8FFF3C]/10" id="profile-name" onChange={(event) => setDraftName(event.target.value)} required value={visibleName} />
              <label className="mt-4 block text-[11px] font-semibold text-[#9DA7B3]" htmlFor="profile-phone">WhatsApp</label>
              <input autoComplete="tel" className="mt-1.5 min-h-12 w-full rounded-xl border border-white/[.1] bg-[#18212D] px-3.5 text-sm font-semibold text-white outline-none transition focus:border-[#8FFF3C]/70 focus:ring-2 focus:ring-[#8FFF3C]/10" id="profile-phone" inputMode="tel" onChange={(event) => setDraftPhone(formatPhoneInput(event.target.value))} placeholder="(19) 98992-4455" required type="tel" value={visiblePhone} />
              <p className="mt-1.5 text-[11px] text-[#9DA7B3]">Informe DDD e número com 10 ou 11 dígitos.</p>
              <ProfileField label="E-mail" value={email} />
              <p className="-mt-2 text-[11px] text-[#788694]">O e-mail da conta não pode ser alterado aqui.</p>
              {errorMessage ? <p aria-live="polite" className="mt-4 rounded-xl bg-[#FF4B4B]/10 px-3 py-2 text-xs text-[#FFB3B3]">Não foi possível salvar seus dados. Tente novamente.</p> : null}
              <div className="mt-5 flex gap-3">
                {!profileNeedsCompletion ? <button className="min-h-12 flex-1 rounded-xl border border-white/[.12] text-sm font-bold text-[#C3CDD7] disabled:opacity-50" disabled={busy} onClick={cancelEditing} type="button">Cancelar</button> : null}
                <button className="min-h-12 flex-1 rounded-xl bg-[#8FFF3C] px-5 text-sm font-extrabold text-[#080D14] transition-opacity disabled:cursor-not-allowed disabled:opacity-45" disabled={busy || !canSave} type="submit">{busy ? 'Salvando...' : 'Salvar dados'}</button>
              </div>
            </form>
          ) : (
            <div className="mt-1 border-t border-white/[.08]">
              <ProfileField label="Nome" value={profile?.full_name || 'Não informado'} />
              <ProfileField label="WhatsApp" value={formatPhone(profile?.phone ?? '') || 'Não informado'} />
              <ProfileField label="E-mail" value={email} />
            </div>
          )}
        </section>

        <PwaInstallCard />
        <button className="mt-7 flex min-h-12 w-full items-center gap-2.5 border-t border-white/[.08] pt-4 text-left text-[13px] font-semibold text-[#D9A2A2] transition-colors hover:text-[#FFB3B3] focus-visible:outline-2 focus-visible:outline-[#FFB3B3] disabled:opacity-50" disabled={busy} onClick={() => void leave()} type="button"><LogoutIcon /> {busy ? 'Saindo...' : 'Sair da conta'}</button>
      </div>
      <PlayerBottomNav />
    </main>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-b border-white/[.07] py-3.5 last:border-0"><span className="block text-[11px] font-semibold text-[#9DA7B3]">{label}</span><span className="mt-1 block break-words text-[13px] font-bold text-white">{value}</span></div>;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ''}` : parts[0].slice(0, 2)).toUpperCase();
}

function formatPhone(value: string) {
  const rawDigits = value.replace(/\D/g, '');
  const digits = rawDigits.length > 11 && rawDigits.startsWith('55') ? rawDigits.slice(2) : rawDigits;
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value;
}

function formatPhoneInput(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.length > 11 && digits.startsWith('55')) digits = digits.slice(2);
  digits = digits.slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  const local = digits.slice(2);
  const prefixLength = digits.length === 11 ? 5 : 4;
  return `(${digits.slice(0, 2)}) ${local.length > prefixLength ? `${local.slice(0, prefixLength)}-${local.slice(prefixLength)}` : local}`;
}

function EditIcon() {
  return <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="15"><path d="m4 16-.7 4.7L8 20l10.7-10.7-4-4L4 16Z" /><path d="m13.5 6.5 4 4" /></svg>;
}

function LogoutIcon() {
  return <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="18"><path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" /><path d="M13 8l4 4-4 4M17 12H8" /></svg>;
}
