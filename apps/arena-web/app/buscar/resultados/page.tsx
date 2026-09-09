'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { ArenaAvailabilityGroup, ArenaResultCard, AvailabilityOption } from '../../../components/arena-result-card';
import { PublicBottomNavigation } from '../../../components/public-bottom-navigation';
import { usePlayerBottomNavigation } from '../../../components/player-bottom-nav';
import { formatDateBR, todayInSaoPaulo } from '../../../lib/format';
import { PageReadyGate } from '../../../providers/page-ready-provider';

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
  return <div className="overflow-hidden rounded-[20px] border border-white/5 bg-[#111923]"><div className="aspect-[16/7] animate-pulse bg-[#18212D]" /><div className="space-y-3 p-5"><div className="h-6 w-3/5 animate-pulse rounded bg-[#18212D]" /><div className="h-20 animate-pulse rounded-2xl bg-[#18212D]" /></div></div>;
}

function ResultsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showPlayerNavigation = usePlayerBottomNavigation();
  const city = searchParams.get('city') ?? '';
  const sport = searchParams.get('sport') ?? '';
  const day = searchParams.get('day') ?? searchParams.get('date') ?? '';
  const time = searchParams.get('time') ?? '';
  const [items, setItems] = useState<AvailabilityOption[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const backToSearch = `/buscar/disponibilidade?${new URLSearchParams({ city, sport }).toString()}`;

  useEffect(() => {
    let cancelled = false;
    const task = window.setTimeout(() => {
      void (async () => {
        setItems(null);
        setError(false);
        try {
          const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
          const response = await fetch(`${base}/availability?city=${encodeURIComponent(city)}&sport=${encodeURIComponent(sport)}&start_at=${encodeURIComponent(`${day}T${time}:00`)}`);
          if (!response.ok) throw new Error('Availability request failed');
          const responseItems = await response.json() as AvailabilityOption[];
          if (!cancelled) setItems(responseItems);
        } catch {
          if (!cancelled) setError(true);
        }
      })();
    }, 0);
    return () => { cancelled = true; window.clearTimeout(task); };
  }, [city, day, reloadVersion, sport, time]);

  function reserve(option: AvailabilityOption) {
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
  return <main className={`min-h-[100dvh] bg-[#080D14] text-white ${showPlayerNavigation ? 'pb-24' : 'pb-[env(safe-area-inset-bottom)]'}`}><PageReadyGate ready={items !== null || error} resourceId="availability" /><div className="mx-auto w-full max-w-[640px] px-4 pb-6 pt-5 sm:px-5"><header className="grid grid-cols-[44px_1fr_44px] items-center"><button aria-label="Voltar para escolher horário" className="grid min-h-11 place-items-center rounded-xl text-2xl text-[#9DA7B3]" onClick={() => router.push(backToSearch)} type="button">‹</button><div><h1 className="text-center text-xl font-black tracking-tight">Arenas disponíveis</h1><p className="mt-2 text-center text-sm font-medium text-[#9DA7B3]">{sport} · {dateLabel} · {time}</p></div><span /></header><section aria-label="Controles de resultados" className="mt-6 flex items-center justify-between gap-3"><button className="flex min-h-12 items-center gap-2 rounded-2xl border border-white/10 bg-[#18212D] px-4 text-sm font-bold text-white" type="button">Mais perto <span className="text-[#9DA7B3]">⌄</span></button><button className="flex min-h-12 items-center gap-2 rounded-2xl border border-white/10 px-4 text-sm font-bold text-white" type="button"><span aria-hidden="true">☷</span> Filtros</button></section><section aria-live="polite" className="mt-5 space-y-4">{items === null && !error ? <><ResultSkeleton /><ResultSkeleton /></> : null}{error ? <div className="rounded-[20px] border border-white/10 bg-[#111923] p-6 text-center"><h2 className="text-lg font-black">Não foi possível carregar as arenas.</h2><button className="mt-4 min-h-12 rounded-2xl bg-[#8FFF3C] px-5 font-black text-[#080D14]" onClick={() => setReloadVersion((version) => version + 1)} type="button">Tentar novamente</button></div> : null}{items && groups.length === 0 ? <div className="rounded-[20px] border border-white/10 bg-[#111923] p-6 text-center"><h2 className="text-xl font-black">Nenhum campo disponível</h2><p className="mt-2 text-sm text-[#9DA7B3]">Não encontramos campos para esse horário.</p><button className="mt-5 min-h-12 rounded-2xl bg-[#8FFF3C] px-5 font-black text-[#080D14]" onClick={() => router.push(backToSearch)} type="button">Escolher outro horário</button></div> : null}{groups.map((group, index) => <ArenaResultCard criticalMedia={index === 0} group={group} key={group.id} onReserve={reserve} sportName={sport} />)}</section></div><PublicBottomNavigation /></main>;
}

export default function Page() {
  return <Suspense fallback={<main className="min-h-[100dvh] bg-[#080D14] p-5 text-white"><div className="mx-auto max-w-[640px]"><ResultSkeleton /><div className="mt-4"><ResultSkeleton /></div></div></main>}><ResultsPage /></Suspense>;
}
