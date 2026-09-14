'use client';

/* This view resolves URL scope and public schedule data after the arena is loaded. */
/* eslint-disable react-hooks/set-state-in-effect */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';

import { ArenaMedia } from '../../../../../components/arena-media';
import { PlayerBottomNav, usePlayerBottomNavigation } from '../../../../../components/player-bottom-nav';
import { trackEvent } from '../../../../../lib/analytics';
import { BRAZIL_TIME_ZONE, formatCurrencyBRL, formatTimeBR, todayInSaoPaulo } from '../../../../../lib/format';
import { usePageReadyResource } from '../../../../../providers/page-ready-provider';

type Court = { id: string; name: string; default_duration_minutes: number; sports: string[] };
type Arena = { name: string; city: string; logo_path?: string | null; courts: Court[] };
type SlotStatus = 'available' | 'reserved' | 'blocked' | 'past' | 'unavailable';
type ScheduleSlot = { court_id: string; start_at: string; end_at: string; duration_minutes: number; status: SlotStatus; price: string | number | null };
type Schedule = { arena_id: string; day: string; is_open: boolean; courts: Court[]; slots: ScheduleSlot[] };

const slotStatus: Record<Exclude<SlotStatus, 'available'>, string> = {
  reserved: 'Reservado', blocked: 'Bloqueado', past: 'Encerrado', unavailable: 'Indisponível',
};

function ArenaSchedulePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const showPlayerNavigation = usePlayerBottomNavigation();
  const today = todayInSaoPaulo();
  const [day, setDay] = useState(today);
  const [stripStart, setStripStart] = useState(today);
  const [selectedCourtId, setSelectedCourtId] = useState(searchParams.get('courtId') ?? '');
  const [arena, setArena] = useState<Arena | null>(null);
  const [arenaError, setArenaError] = useState('');
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const scheduleViewRef = useRef('');

  const activeCourtId = arena?.courts.some((court) => court.id === selectedCourtId)
    ? selectedCourtId
    : arena?.courts[0]?.id ?? '';
  const activeCourt = arena?.courts.find((court) => court.id === activeCourtId) ?? null;
  const visibleDates = Array.from({ length: 7 }, (_, index) => addDays(stripStart, index));

  useEffect(() => {
    let cancelled = false;
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
    setArenaError('');
    void fetch(`${base}/arenas/${id}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<Arena> : Promise.reject())
      .then((result) => { if (!cancelled) setArena(result); })
      .catch(() => { if (!cancelled) setArenaError('Não foi possível carregar esta arena.'); });
    return () => { cancelled = true; };
  }, [id, retry]);

  useEffect(() => {
    if (!arena || !activeCourtId) return;
    let cancelled = false;
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
    setScheduleError('');
    setSchedule(null);
    setScheduleLoading(true);
    void fetch(`${base}/arenas/${id}/schedule?${new URLSearchParams({ day, court_id: activeCourtId }).toString()}`, { cache: 'no-store' })
      .then((response) => response.ok ? response.json() as Promise<Schedule> : Promise.reject())
      .then((result) => { if (!cancelled) setSchedule(result); })
      .catch(() => { if (!cancelled) setScheduleError('Não foi possível carregar os horários.'); })
      .finally(() => { if (!cancelled) setScheduleLoading(false); });
    return () => { cancelled = true; };
  }, [activeCourtId, arena, day, id, retry]);

  useEffect(() => {
    if (!schedule || !arena || !activeCourtId) return;
    const key = `${id}:${activeCourtId}:${day}`;
    if (scheduleViewRef.current === key) return;
    scheduleViewRef.current = key;
    trackEvent('arena_schedule_viewed', {
      arenaId: id,
      courtId: activeCourtId,
      properties: { date: day, source: 'arena_detail' },
      dedupeKey: `arena-schedule:${key}`,
    });
  }, [activeCourtId, arena, day, id, schedule]);

  usePageReadyResource('arena-schedule-arena', Boolean(arena || arenaError));
  usePageReadyResource('arena-schedule-slots', Boolean(arena && (!activeCourtId || schedule || scheduleError)));

  function changeDay(nextDay: string) {
    if (nextDay < today) return;
    setDay(nextDay);
    if (nextDay < stripStart || nextDay > addDays(stripStart, 6)) setStripStart(maxDate(today, addDays(nextDay, -2)));
  }

  function reserve(slot: ScheduleSlot) {
    if (!arena || !activeCourt || slot.status !== 'available' || slot.price === null) return;
    const params = new URLSearchParams({
      arena: arena.name,
      arenaId: id,
      court: activeCourt.name,
      courtId: activeCourt.id,
      sport: activeCourt.sports[0] ?? 'Modalidade',
      startAt: slot.start_at,
      endAt: slot.end_at,
      price: String(slot.price),
      duration: String(slot.duration_minutes),
    });
    if (arena.logo_path) params.set('logoPath', arena.logo_path);
    trackEvent('reservation_started', {
      arenaId: id,
      courtId: activeCourt.id,
      properties: { date: day, time: formatTimeBR(slot.start_at), source: 'arena_schedule' },
    });
    router.push(`/reservar?${params.toString()}`);
  }

  if (arenaError) return <LoadError label={arenaError} onBack={() => router.back()} onRetry={() => setRetry((value) => value + 1)} showNavigation={showPlayerNavigation} />;
  if (!arena) return <ScheduleSkeleton showNavigation={showPlayerNavigation} />;

  const slots = schedule?.slots ?? [];
  const hasAvailableSlots = slots.some((slot) => slot.status === 'available');
  const sportLabel = activeCourt?.sports.join(' • ') || 'Modalidade';

  return <main className={`min-h-[100dvh] overflow-x-hidden bg-[#080D14] text-white ${showPlayerNavigation ? 'pb-[calc(5.5rem+env(safe-area-inset-bottom))]' : 'pb-[max(1rem,env(safe-area-inset-bottom))]'}`}>
    <div aria-hidden="true" className="fixed inset-x-0 top-0 h-56 bg-[radial-gradient(circle_at_75%_-10%,rgba(143,255,60,.12),transparent_52%),linear-gradient(180deg,#101c22_0%,#080D14_86%)]" />
    <div className="relative mx-auto w-full max-w-[640px] px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-5">
      <header className="flex min-h-10 items-center justify-between">
        <button aria-label="Voltar para detalhes da arena" className="flex min-h-10 items-center gap-2 text-sm font-bold text-[#D7DEE7] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8FFF3C]" onClick={() => router.back()} type="button"><ArrowLeftIcon />Voltar</button>
        <span className="text-[10px] font-black uppercase tracking-[.18em] text-[#94A2B1]">Disponibilidade</span>
      </header>

      <section className="mt-5 flex items-center gap-3 border-b border-white/[.08] pb-5">
        <ArenaMedia arena={arena} className="h-12 w-12 shrink-0 rounded-[15px] border border-white/10" prefer="logo" sport={activeCourt?.sports[0]} variant="ticket" />
        <div className="min-w-0"><h1 className="truncate text-xl font-extrabold tracking-[-.04em]">{arena.name}</h1><p className="mt-1 truncate text-sm font-semibold text-[#AAB7C5]">{arena.city} <span className="text-[#8FFF3C]">•</span> {sportLabel}</p></div>
      </section>

      <section aria-label="Escolha a data" className="mt-5">
        <div className="grid grid-cols-[40px_1fr_40px_42px] items-center gap-1">
          <button aria-label="Mostrar datas anteriores" className="grid min-h-10 place-items-center rounded-xl text-[#AAB7C5] transition hover:bg-white/[.06] disabled:opacity-30" disabled={stripStart <= today} onClick={() => setStripStart((current) => maxDate(today, addDays(current, -7)))} type="button"><ChevronIcon direction="left" /></button>
          <p className="text-center text-[11px] font-black uppercase tracking-[.16em] text-[#D7DEE7]">{monthLabel(day)}</p>
          <button aria-label="Mostrar próximas datas" className="grid min-h-10 place-items-center rounded-xl text-[#AAB7C5] transition hover:bg-white/[.06]" onClick={() => setStripStart((current) => addDays(current, 7))} type="button"><ChevronIcon direction="right" /></button>
          <label aria-label="Escolher data pelo calendário" className="relative grid min-h-10 place-items-center overflow-hidden rounded-xl border border-white/10 bg-white/[.035] text-[#8FFF3C]"><CalendarIcon /><input className="absolute inset-0 cursor-pointer opacity-0" min={today} onChange={(event) => changeDay(event.target.value)} type="date" value={day} /></label>
        </div>
        <div className="mt-3 flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
          {visibleDates.map((date) => <button aria-pressed={date === day} className={`min-h-[68px] min-w-[60px] snap-start rounded-[16px] border px-2 text-center transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8FFF3C] ${date === day ? 'border-[#8FFF3C] bg-[#8FFF3C] text-[#080D14]' : 'border-white/[.09] bg-[#111923] text-[#D7DEE7] hover:border-white/20'}`} key={date} onClick={() => changeDay(date)} type="button"><span className="block text-[9px] font-black uppercase tracking-[.1em]">{date === today ? 'Hoje' : weekdayLabel(date)}</span><strong className="mt-1 block text-xl leading-none">{date.slice(-2)}</strong></button>)}
        </div>
      </section>

      <section className="mt-5">
        <div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[.17em] text-[#8FFF3C]">Quadra</p><h2 className="mt-1 text-lg font-extrabold">{activeCourt?.name ?? 'Quadra indisponível'}</h2></div>{arena.courts.length > 1 ? <label className="sr-only" htmlFor="arena-schedule-court">Selecionar quadra</label> : null}{arena.courts.length > 1 ? <select className="min-h-10 max-w-[52%] rounded-xl border border-white/10 bg-[#111923] px-3 text-sm font-bold text-white outline-none focus:border-[#8FFF3C]" id="arena-schedule-court" onChange={(event) => setSelectedCourtId(event.target.value)} value={activeCourtId}>{arena.courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select> : null}</div>
        <p className="mt-1 text-sm text-[#AAB7C5]">{sportLabel} {activeCourt ? `• ${activeCourt.default_duration_minutes} min` : ''}</p>
      </section>

      <section className="mt-6 pb-6" aria-labelledby="schedule-title">
        <div className="flex items-center justify-between"><h2 className="text-[11px] font-black uppercase tracking-[.18em] text-[#D7DEE7]" id="schedule-title">Agenda completa</h2>{schedule?.is_open ? <span className="text-xs font-bold text-[#8FFF3C]">Aberto neste dia</span> : null}</div>
        {scheduleLoading && !schedule ? <SlotSkeleton /> : null}
        {scheduleError ? <InlineError onRetry={() => setRetry((value) => value + 1)} /> : null}
        {!scheduleLoading && schedule && !schedule.is_open ? <ScheduleState title="Arena fechada neste dia" description="Escolha outra data para conferir os próximos horários." actionLabel="Ver amanhã" onAction={() => changeDay(addDays(day, 1))} /> : null}
        {!scheduleLoading && schedule?.is_open && slots.length === 0 ? <ScheduleState title="Nenhum horário configurado" description="Esta quadra ainda não possui horários disponíveis para esta data." /> : null}
        {schedule?.is_open && slots.length > 0 ? <><ul className="mt-4 space-y-2">{slots.map((slot) => <SlotCard key={`${slot.court_id}-${slot.start_at}`} onReserve={() => reserve(slot)} slot={slot} />)}</ul>{!hasAvailableSlots ? <p className="mt-4 rounded-2xl border border-white/[.08] bg-white/[.025] px-4 py-3 text-sm font-semibold text-[#AAB7C5]">Não há horários livres nesta data. Tente outro dia.</p> : null}</> : null}
      </section>
    </div>
    <PlayerBottomNav />
  </main>;
}

function SlotCard({ slot, onReserve }: { slot: ScheduleSlot; onReserve: () => void }) {
  const available = slot.status === 'available' && slot.price !== null;
  const unavailableLabel = slot.status === 'available' ? '' : slotStatus[slot.status];
  return <li className={`flex min-h-[72px] items-center justify-between gap-3 rounded-[18px] border p-3.5 ${available ? 'border-[#8FFF3C]/25 bg-[#8FFF3C]/[.055]' : 'border-white/[.08] bg-[#111923]/85'}`}><div className="min-w-0"><p className="whitespace-nowrap text-lg font-extrabold tracking-[-.035em]">{formatTimeBR(slot.start_at)} <span className="text-sm font-semibold text-[#AAB7C5]">às {formatTimeBR(slot.end_at)}</span></p><p className="mt-1 text-xs font-semibold text-[#9DA7B3]">{slot.duration_minutes} min</p></div>{available ? <div className="flex shrink-0 items-center gap-2"><p className="whitespace-nowrap text-right text-xs font-extrabold text-white">{formatCurrencyBRL(slot.price)}</p><button className="min-h-10 rounded-xl bg-[#8FFF3C] px-4 text-sm font-black text-[#080D14] transition hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8FFF3C]" onClick={onReserve} type="button">Reservar</button></div> : <span className="shrink-0 rounded-full border border-white/10 bg-white/[.04] px-3 py-2 text-[11px] font-bold text-[#AAB7C5]">{unavailableLabel}</span>}</li>;
}

function ScheduleState({ title, description, actionLabel, onAction }: { title: string; description: string; actionLabel?: string; onAction?: () => void }) { return <div className="mt-4 rounded-[20px] border border-white/[.08] bg-[#111923] p-5 text-center"><h3 className="text-base font-extrabold">{title}</h3><p className="mx-auto mt-2 max-w-[34ch] text-sm leading-5 text-[#AAB7C5]">{description}</p>{actionLabel && onAction ? <button className="mt-4 text-sm font-bold text-[#8FFF3C]" onClick={onAction} type="button">{actionLabel} →</button> : null}</div>; }
function InlineError({ onRetry }: { onRetry: () => void }) { return <div className="mt-4 rounded-[20px] border border-[#FF4B4B]/25 bg-[#FF4B4B]/10 p-5 text-center"><p className="text-sm font-semibold text-[#FFB3B3]">Não foi possível carregar os horários.</p><button className="mt-3 text-sm font-bold text-[#8FFF3C]" onClick={onRetry} type="button">Tentar novamente</button></div>; }
function SlotSkeleton() { return <div className="mt-4 space-y-2">{[1, 2, 3, 4].map((item) => <div className="h-[72px] animate-pulse rounded-[18px] bg-[#111923]" key={item} />)}</div>; }
function ScheduleSkeleton({ showNavigation }: { showNavigation: boolean }) { return <main className={`min-h-[100dvh] bg-[#080D14] px-4 pt-[max(1rem,env(safe-area-inset-top))] text-white ${showNavigation ? 'pb-28' : 'pb-6'}`}><div className="mx-auto max-w-[640px]"><div className="h-10 w-24 animate-pulse rounded-xl bg-[#18212D]" /><div className="mt-6 h-14 animate-pulse rounded-2xl bg-[#111923]" /><div className="mt-6 h-20 animate-pulse rounded-2xl bg-[#111923]" /><SlotSkeleton /></div><PlayerBottomNav /></main>; }
function LoadError({ label, onBack, onRetry, showNavigation }: { label: string; onBack: () => void; onRetry: () => void; showNavigation: boolean }) { return <main className={`min-h-[100dvh] bg-[#080D14] px-5 pt-[max(1rem,env(safe-area-inset-top))] text-white ${showNavigation ? 'pb-28' : 'pb-6'}`}><div className="mx-auto max-w-[640px]"><button className="min-h-10 text-sm font-bold text-[#D7DEE7]" onClick={onBack} type="button">← Voltar</button><section className="mt-20 text-center"><h1 className="text-xl font-extrabold">{label}</h1><button className="mt-5 rounded-2xl bg-[#8FFF3C] px-5 py-3 text-sm font-black text-[#080D14]" onClick={onRetry} type="button">Tentar novamente</button></section></div><PlayerBottomNav /></main>; }

function addDays(iso: string, days: number) { const date = new Date(`${iso}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function maxDate(left: string, right: string) { return left > right ? left : right; }
function weekdayLabel(iso: string) { return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: BRAZIL_TIME_ZONE }).format(new Date(`${iso}T12:00:00Z`)).replace('.', '').toUpperCase(); }
function monthLabel(iso: string) { return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: BRAZIL_TIME_ZONE }).format(new Date(`${iso}T12:00:00Z`)).toUpperCase(); }
function ArrowLeftIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6M9 12h12" /></svg>; }
function ChevronIcon({ direction }: { direction: 'left' | 'right' }) { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} /></svg>; }
function CalendarIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><rect height="16" rx="2" width="18" x="3" y="5" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>; }

export default function Page() { return <Suspense fallback={<ScheduleSkeleton showNavigation={false} />}><ArenaSchedulePage /></Suspense>; }
