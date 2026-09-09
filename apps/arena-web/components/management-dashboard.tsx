'use client';
/* eslint-disable @next/next/no-img-element -- Supabase public assets and local upload previews use dynamic URLs. */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import { getArenaLogoUrl } from '../lib/arena-logo';
import { BRAZIL_TIME_ZONE, formatCurrencyBRL, formatTimeBR, reservationStatusLabel } from '../lib/format';
import { useAuth } from './use-auth';
import { usePageReadyResource } from '../providers/page-ready-provider';

type Summary = {
  reservations_today: number;
  reservations_week: number;
  app_revenue: string | number;
  occupancy_today: string | number;
  pending_count: number;
  next_reservations: { id: string; customer_name: string; court_name: string; start_at: string; status: string }[];
};
type LoadState = 'loading' | 'error' | 'success';
type OpeningHour = { weekday: number; open_time: string; close_time: string; active: boolean };

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'PA';
}

export function ManagementDashboard() {
  const { profile, ownedArenas, session } = useAuth();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [arenaOpen, setArenaOpen] = useState<boolean | null>(null);
  const arenaName = ownedArenas.length === 1 ? ownedArenas[0].name : 'Suas arenas';
  const primaryArena = ownedArenas[0];
  usePageReadyResource('owner-dashboard', loadState !== 'loading');

  useEffect(() => {
    if (!session?.access_token) return;
    let active = true;
    const task = window.setTimeout(() => {
      void (async () => {
        setLoadState('loading');
        try {
          const data = await apiRequest<Summary>('/owner/dashboard-summary', session.access_token);
          if (active) { setSummary(data); setLoadState('success'); }
        } catch {
          if (active) { setSummary(null); setLoadState('error'); }
        }
      })();
    }, 0);
    const refreshSummary = () => setRefreshVersion((version) => version + 1);
    window.addEventListener('playarena:reservations-changed', refreshSummary);
    return () => { active = false; window.clearTimeout(task); window.removeEventListener('playarena:reservations-changed', refreshSummary); };
  }, [refreshVersion, session?.access_token]);

  useEffect(() => {
    if (!session?.access_token || !primaryArena) return;
    let active = true;
    const task = window.setTimeout(() => {
      void apiRequest<OpeningHour[]>(`/owner/arenas/${primaryArena.id}/opening-hours`, session.access_token)
        .then((hours) => { if (active) setArenaOpen(isArenaOpenNow(hours)); })
        .catch(() => { if (active) setArenaOpen(null); });
    }, 0);
    return () => { active = false; window.clearTimeout(task); };
  }, [primaryArena, session?.access_token]);

  const isLoading = loadState === 'loading';
  const upcoming = summary?.next_reservations ?? [];
  const reservationsToday = summary?.reservations_today ?? '—';
  const occupancyToday = summary ? `${Number(summary.occupancy_today).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—';
  const revenueToday = summary ? formatCurrencyBRL(summary.app_revenue) : '—';

  return <div className="mx-auto w-full max-w-[640px] pb-28">
    <header className="mb-4"><ArenaIdentity arenaName={arenaName} avatar={initials(profile?.full_name ?? '')} isOpen={arenaOpen} key={`${primaryArena?.logo_path ?? 'fallback'}-${primaryArena?.updated_at ?? ''}`} logoPath={primaryArena?.logo_path} version={primaryArena?.updated_at}/></header>

    <section aria-labelledby="today-heading" className="overflow-hidden rounded-[24px] bg-[#111923] px-5 py-5 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
      <div className="flex items-baseline justify-between"><h2 className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#9DA7B3]" id="today-heading">Hoje</h2><span className="h-2 w-2 rounded-full bg-[#8FFF3C]" title="Resumo atualizado" /></div>
      <div className="mt-6 grid grid-cols-2 divide-x divide-white/10">
        <TopMetric loading={isLoading} label={summary?.reservations_today === 1 ? 'reserva' : 'reservas'} value={reservationsToday} />
        <TopMetric loading={isLoading} label="ocupação" value={occupancyToday} />
      </div>
      <div className="mt-5 min-w-0">
        <strong className={`block whitespace-nowrap text-[clamp(1.125rem,6vw,1.5rem)] font-extrabold tabular-nums tracking-[-0.04em] text-white ${isLoading ? 'animate-pulse' : ''}`}>{revenueToday}</strong>
        <span className="mt-1 block text-xs text-[#9DA7B3]">via PlayArena</span>
      </div>
      <p className="mt-5 border-t border-white/10 pt-4 text-sm text-[#9DA7B3]">{summary ? `${summary.reservations_week} ${summary.reservations_week === 1 ? 'reserva esta semana' : 'reservas esta semana'}` : 'Resumo semanal indisponível'}</p>
    </section>

    {loadState === 'error' ? <section className="mt-4 rounded-2xl border border-[#FF4B4B]/20 bg-[#FF4B4B]/10 p-4"><p className="text-sm font-semibold text-white">Não foi possível carregar o resumo.</p><button className="mt-2 min-h-11 text-sm font-bold text-[#8FFF3C]" onClick={() => setRefreshVersion((version) => version + 1)} type="button">Tentar novamente</button></section> : null}

    {loadState === 'success' && summary && summary.pending_count > 0 ? <section className="mt-5" aria-labelledby="attention-heading"><h2 className="mb-3 px-1 text-xs font-extrabold uppercase tracking-[0.18em] text-[#9DA7B3]" id="attention-heading">Precisa da sua atenção</h2><Link className="flex min-h-[72px] items-center gap-4 rounded-2xl border border-[#8FFF3C]/25 bg-[#8FFF3C]/10 px-4 transition hover:bg-[#8FFF3C]/15" href="/dashboard/reservas"><span className="flex h-10 min-w-10 items-center justify-center rounded-full bg-[#8FFF3C] text-sm font-extrabold text-[#080D14]">{summary.pending_count}</span><span className="min-w-0 flex-1 text-sm font-bold text-white">{summary.pending_count === 1 ? 'Pré-reserva aguardando confirmação' : 'Pré-reservas aguardando confirmação'}</span><span aria-hidden="true" className="text-xl text-[#8FFF3C]">›</span></Link></section> : null}

    <section className="mt-8" aria-labelledby="upcoming-heading"><div className="flex items-center justify-between px-1"><h2 className="text-lg font-bold tracking-[-0.03em] text-white" id="upcoming-heading">Próximos horários</h2><Link className="min-h-11 px-1 py-3 text-sm font-bold text-[#8FFF3C]" href="/dashboard/agenda">Ver agenda</Link></div>
      {isLoading ? <div className="mt-3 space-y-3"><div className="h-[74px] animate-pulse rounded-2xl bg-[#111923]" /><div className="h-[74px] animate-pulse rounded-2xl bg-[#111923]" /></div> : null}
      {loadState === 'success' && upcoming.length > 0 ? <div className="mt-3 border-l border-white/10 pl-4">{upcoming.map((item, index) => <article className={`relative grid grid-cols-[52px_1fr] gap-3 py-4 ${index > 0 ? 'border-t border-white/10' : ''}`} key={item.id}><span className="relative text-sm font-extrabold text-white"><i aria-hidden="true" className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-[#8FFF3C]" />{formatTimeBR(item.start_at)}</span><div><p className="text-sm font-bold text-white">{item.court_name}</p><p className="mt-1 text-sm text-[#9DA7B3]">{item.customer_name}</p><p className={`mt-2 text-xs font-bold ${item.status === 'pending' ? 'text-[#8FFF3C]' : 'text-[#9DA7B3]'}`}>{reservationStatusLabel[item.status] ?? item.status}</p></div></article>)}</div> : null}
      {loadState === 'success' && upcoming.length === 0 ? <div className="mt-3 border-l border-white/10 py-3 pl-4"><p className="font-semibold text-white">Agenda livre por enquanto</p><p className="mt-1 text-sm text-[#9DA7B3]">Você não tem próximas reservas.</p><Link className="mt-3 inline-block text-sm font-bold text-[#8FFF3C]" href="/dashboard/agenda">Ver agenda</Link></div> : null}
      {loadState === 'error' ? <p className="mt-3 text-sm text-[#9DA7B3]">Próximos horários indisponíveis no momento.</p> : null}
    </section>
  </div>;
}

function TopMetric({ label, loading, value }: { label: string; loading: boolean; value: string | number }) {
  return <div className="min-w-0 px-3 first:pl-0 last:pr-0"><strong className={`block text-2xl font-bold tracking-[-0.05em] text-white ${loading ? 'animate-pulse' : ''}`}>{value}</strong><span className="mt-1 block text-xs leading-4 text-[#9DA7B3]">{label}</span></div>;
}

function isArenaOpenNow(hours: OpeningHour[]) {
  const parts = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: BRAZIL_TIME_ZONE }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday'));
  const now = `${value('hour')}:${value('minute')}`;
  return hours.some((hour) => hour.weekday === weekday && hour.active && hour.open_time.slice(0, 5) <= now && now < hour.close_time.slice(0, 5));
}

function ArenaIdentity({ arenaName, avatar, isOpen, logoPath, version }: { arenaName: string; avatar: string; isOpen: boolean | null; logoPath?: string | null; version?: string }) {
  const [failed, setFailed] = useState(false);
  const logoUrl = failed ? null : getArenaLogoUrl(logoPath, version);
  return <section className="arena-spotlight relative h-[196px] overflow-hidden rounded-[26px] px-5 pt-4"><div className="relative flex items-center justify-between"><span className="text-sm font-extrabold tracking-[-0.04em] text-white">Play<span className="text-[#8FFF3C]">Arena</span></span><span aria-label="Perfil do proprietário" className="flex h-10 w-10 items-center justify-center rounded-full border border-[#8FFF3C]/30 bg-[#18212D]/90 text-xs font-extrabold text-[#8FFF3C]">{avatar}</span></div><div className="relative mt-3 flex flex-col items-center"><div className="flex h-[94px] w-full max-w-[180px] items-center justify-center"><>{logoUrl ? <img alt={`Logo de ${arenaName}`} className="max-h-[92px] max-w-[180px] object-contain" onError={() => setFailed(true)} src={logoUrl} /> : <h1 className="max-w-full truncate text-center text-3xl font-extrabold uppercase tracking-[-0.06em] text-white">{arenaName}</h1>}</></div>{isOpen !== null ? <span className={`mt-1 flex items-center gap-1.5 rounded-full border px-3 py-1 text-[10px] font-extrabold tracking-[0.13em] ${isOpen ? 'border-[#8FFF3C]/25 bg-[#8FFF3C]/10 text-[#8FFF3C]' : 'border-white/10 bg-white/5 text-[#9DA7B3]'}`}><i aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${isOpen ? 'bg-[#8FFF3C]' : 'bg-[#9DA7B3]'}`} />{isOpen ? 'ABERTA' : 'FECHADA'}</span> : null}</div><span aria-hidden="true" className="arena-field-lines" /></section>;
}
