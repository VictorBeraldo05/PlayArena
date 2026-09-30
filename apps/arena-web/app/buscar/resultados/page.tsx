'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { ArenaAvailabilityGroup, ArenaResultCard, AvailabilityOption } from '../../../components/arena-result-card';
import { PublicBottomNavigation } from '../../../components/public-bottom-navigation';
import { usePlayerBottomNavigation } from '../../../components/player-bottom-nav';
import { formatDateBR, todayInSaoPaulo } from '../../../lib/format';
import { PageReadyGate } from '../../../providers/page-ready-provider';
import { trackEvent } from '../../../lib/analytics';

function groupByArena(options: AvailabilityOption[]): ArenaAvailabilityGroup[] {
  const groups = new Map<string, ArenaAvailabilityGroup>();
  options.forEach((option) => {
    const group = groups.get(option.arena_id);
    if (group) group.options.push(option);
    else groups.set(option.arena_id, { id: option.arena_id, name: option.arena_name, logo_path: option.logo_path, options: [option] });
  });
  return [...groups.values()];
}

function ResultSkeleton() {
  return <div aria-hidden="true" className="overflow-hidden rounded-[19px] border border-white/[0.07] bg-[#111923]">
    <div className="flex items-center gap-3 p-3.5"><div className="h-[76px] w-[76px] shrink-0 animate-pulse rounded-[13px] bg-[#23303D]" /><div className="flex-1 space-y-2"><div className="h-5 w-3/5 animate-pulse rounded bg-[#23303D]" /><div className="h-3 w-2/5 animate-pulse rounded bg-[#23303D]" /><div className="h-3 w-1/4 animate-pulse rounded bg-[#23303D]" /></div></div>
    <div className="border-t border-white/[0.07] px-5 py-2"><div className="h-[54px] animate-pulse border-b border-white/[0.05]" /><div className="h-[54px] animate-pulse" /></div>
  </div>;
}

function ResultsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showPlayerNavigation = usePlayerBottomNavigation();
  const city = searchParams.get('city') ?? '';
  const sport = searchParams.get('sport') ?? '';
  const day = searchParams.get('day') ?? searchParams.get('date') ?? '';
  const time = searchParams.get('time') ?? '';
  const arenaId = searchParams.get('arenaId') ?? '';
  const courtId = searchParams.get('courtId') ?? '';
  const [items, setItems] = useState<AvailabilityOption[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const backParams = new URLSearchParams({ sport });
  if (city) backParams.set('city', city);
  if (arenaId) backParams.set('arenaId', arenaId);
  if (courtId) backParams.set('courtId', courtId);
  const backToSearch = `/buscar/disponibilidade?${backParams.toString()}`;

  useEffect(() => {
    let cancelled = false;
    const task = window.setTimeout(() => {
      void (async () => {
        setItems(null);
        setError(false);
        try {
          const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
          const query = new URLSearchParams({ sport, start_at: `${day}T${time}:00` });
          if (city) query.set('city', city);
          if (arenaId) query.set('arena_id', arenaId);
          if (courtId) query.set('court_id', courtId);
          const response = await fetch(`${base}/availability?${query.toString()}`);
          if (!response.ok) throw new Error('Availability request failed');
          const responseItems = await response.json() as AvailabilityOption[];
          if (!cancelled) { setItems(responseItems); trackEvent(responseItems.length ? 'availability_results_viewed' : 'availability_no_results', { arenaId: arenaId || undefined, courtId: courtId || undefined, properties: { city, sport, date: day, time, results_count: responseItems.length, source: arenaId ? 'arena_detail' : 'new_reservation' }, dedupeKey: `availability-result:${city}:${sport}:${day}:${time}:${arenaId}:${courtId}` }); }
        } catch {
          if (!cancelled) setError(true);
        }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(task); };
  }, [arenaId, city, courtId, day, reloadVersion, sport, time]);

  function reserve(option: AvailabilityOption) {
    trackEvent('reservation_started', { arenaId: option.arena_id, courtId: option.court_id, properties: { sport, start_at: option.start_at }, dedupeKey: `reservation-start:${option.court_id}:${option.start_at}` });
    const params = new URLSearchParams({
      arenaId: option.arena_id,
      arena: option.arena_name,
      court: option.court_name,
      courtId: option.court_id,
      sport,
      startAt: option.start_at,
      endAt: option.end_at,
      price: String(option.price),
      duration: String(option.duration_minutes),
    });
    if (option.logo_path) params.set('logoPath', option.logo_path);
    router.push(`/reservar?${params.toString()}`);
  }

  const groups = items ? groupByArena(items) : [];
  const dateLabel = day === todayInSaoPaulo() ? 'Hoje' : formatDateBR(day).slice(0, 5);
  const resultsTitle = arenaId ? 'Horários disponíveis' : 'Arenas disponíveis';
  const searchSummary = [sport, `${dateLabel}, ${time}`, city].filter(Boolean).join(' · ');
  const resultCount = items ? `${items.length} ${items.length === 1 ? 'opção' : 'opções'} em ${groups.length} ${groups.length === 1 ? 'arena' : 'arenas'}` : '';

  return <main className={`min-h-[100dvh] bg-[#080D14] text-white ${showPlayerNavigation ? 'pb-24' : 'pb-[env(safe-area-inset-bottom)]'}`}>
    <PageReadyGate ready={items !== null || error} resourceId="availability" />
    <div className="mx-auto w-full max-w-[640px] px-4 pb-6 pt-4 sm:px-5">
      <header className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center">
        <button aria-label="Voltar para escolher horário" className="grid min-h-11 place-items-center rounded-xl text-[#9DA7B3] transition-colors hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8FFF3C]" onClick={() => router.push(backToSearch)} type="button"><svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg></button>
        <div className="min-w-0"><h1 className="truncate text-center text-[18px] font-extrabold tracking-[-0.03em]">{resultsTitle}</h1><p className="mt-1 truncate text-center text-[12px] font-medium text-[#9DA7B3]" title={searchSummary}>{searchSummary}</p></div>
        <span />
      </header>
      <section aria-label="Controles de resultados" className="mt-5 flex items-center justify-between gap-3">
        <button className="flex min-h-10 items-center gap-2 rounded-xl border border-white/[0.09] bg-[#18212D] px-3.5 text-[12px] font-bold text-[#E8EDF1] transition-colors hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8FFF3C]" type="button">Mais perto <span aria-hidden="true" className="text-[#9DA7B3]">⌄</span></button>
        <button className="flex min-h-10 items-center gap-2 rounded-xl border border-white/[0.09] px-3.5 text-[12px] font-bold text-[#E8EDF1] transition-colors hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8FFF3C]" type="button"><svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24"><path d="M4 7h16M7 12h10M10 17h4" /></svg>Filtros</button>
      </section>
      {items && groups.length > 0 ? <p className="mb-2.5 mt-5 px-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#9DA7B3]">{resultCount}</p> : null}
      <section aria-label="Resultados da busca" aria-live="polite" className={`${items && groups.length > 0 ? '' : 'mt-5'} space-y-3.5`}>
        {items === null && !error ? <><ResultSkeleton /><ResultSkeleton /></> : null}
        {error ? <div className="rounded-[19px] border border-white/10 bg-[#111923] p-6 text-center"><h2 className="text-lg font-black">Não foi possível carregar as arenas.</h2><button className="mt-4 min-h-12 rounded-2xl bg-[#8FFF3C] px-5 font-black text-[#080D14]" onClick={() => setReloadVersion((version) => version + 1)} type="button">Tentar novamente</button></div> : null}
        {items && groups.length === 0 ? <div className="rounded-[19px] border border-white/10 bg-[#111923] p-6 text-center"><h2 className="text-xl font-black">Nenhum campo disponível</h2><p className="mt-2 text-sm text-[#9DA7B3]">Não encontramos campos para esse horário.</p><button className="mt-5 min-h-12 rounded-2xl bg-[#8FFF3C] px-5 font-black text-[#080D14]" onClick={() => router.push(backToSearch)} type="button">Escolher outro horário</button></div> : null}
        {groups.map((group, index) => <ArenaResultCard criticalMedia={index === 0} group={group} key={group.id} onReserve={reserve} searchedTime={time} sportName={sport} />)}
      </section>
    </div>
    <PublicBottomNavigation />
  </main>;
}

export default function Page() {
  return <Suspense fallback={<main className="min-h-[100dvh] bg-[#080D14] p-5 text-white"><div className="mx-auto max-w-[640px]"><ResultSkeleton /><div className="mt-4"><ResultSkeleton /></div></div></main>}><ResultsPage /></Suspense>;
}
