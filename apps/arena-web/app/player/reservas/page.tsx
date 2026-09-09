'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import { PlayerBottomNav as PlayerNavigation } from '../../../components/player-bottom-nav';
import { useAuth } from '../../../components/use-auth';
import { apiRequest } from '../../../lib/api';
import { BRAZIL_TIME_ZONE, formatCurrencyBRL, formatReservationDateParts, formatReservationTimeRange, formatTimeBR } from '../../../lib/format';
import { usePageReadyResource } from '../../../providers/page-ready-provider';

type Reservation = { id: string; arena_name: string; court_name: string; start_at: string; end_at: string; price: string; status: string };
type Tab = 'upcoming' | 'history';

const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: BRAZIL_TIME_ZONE });

export default function PlayerReservationsPage() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [items, setItems] = useState<Reservation[] | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('upcoming');
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [now] = useState(() => Date.now());
  usePageReadyResource('player-reservations', items !== null || Boolean(error));

  useEffect(() => {
    if (!token) return;
    const accessToken = token;
    let active = true;
    async function loadReservations() {
      try {
        const reservations = await apiRequest<Reservation[]>('/player/reservations', accessToken, { cache: 'no-store' });
        if (active) { setItems(reservations); setError(''); }
      } catch (requestError) {
        const message = requestError instanceof Error ? requestError.message : '';
        const friendlyError = message === 'Player access required.' ? 'Entre novamente com sua conta de jogador para ver suas reservas.' : 'Não foi possível carregar suas reservas. Tente novamente.';
        if (active) { setItems([]); setError(friendlyError); }
      }
    }
    void loadReservations();
    return () => { active = false; };
  }, [token]);

  const reservations = items ?? [];
  const upcoming = reservations.filter((item) => isUpcoming(item, now)).sort((left, right) => new Date(left.start_at).getTime() - new Date(right.start_at).getTime());
  const history = reservations.filter((item) => !isUpcoming(item, now)).sort((left, right) => new Date(right.start_at).getTime() - new Date(left.start_at).getTime());

  return <main className="player-reservations-page min-h-[100dvh] bg-[#080D14] pb-28 text-white">
    <div aria-hidden="true" className="player-reservations-ambient fixed inset-x-0 top-0 h-[300px]" />
    <div className="relative mx-auto w-full max-w-[640px] px-4 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-5">
      <header className="reservation-agenda-reveal reservation-agenda-header flex items-center justify-between gap-4"><div><h1 className="text-[28px] font-extrabold leading-none tracking-[-.055em]">Minhas reservas</h1>{upcoming.length > 0 ? <p className="mt-2 text-xs font-bold uppercase tracking-[.14em] text-[#9DA7B3]">{upcoming.length} {upcoming.length === 1 ? 'próxima' : 'próximas'}</p> : null}</div><span aria-hidden="true" className="reservation-calendar-icon"><CalendarIcon /></span></header>
      <div aria-label="Reservas" className="reservation-agenda-tabs reservation-agenda-reveal mt-7 grid grid-cols-2" role="tablist"><button aria-selected={tab === 'upcoming'} className={tab === 'upcoming' ? 'is-active' : ''} onClick={() => setTab('upcoming')} role="tab" type="button">Próximas {upcoming.length > 0 ? <span>{upcoming.length}</span> : null}</button><button aria-selected={tab === 'history'} className={tab === 'history' ? 'is-active' : ''} onClick={() => setTab('history')} role="tab" type="button">Histórico</button></div>
      {error ? <p className="mt-5 rounded-2xl border border-[#FF4B4B]/20 bg-[#FF4B4B]/10 p-4 text-sm font-semibold text-[#FFB3B3]">{error}</p> : null}
      {items === null && !error ? <ReservationsSkeleton /> : null}
      {items !== null ? <section className="reservation-tab-panel" key={tab} role="tabpanel">{tab === 'upcoming' ? <UpcomingReservations onSelect={setSelectedReservation} reservations={upcoming} /> : <ReservationHistory onSelect={setSelectedReservation} reservations={history} />}</section> : null}
    </div>
    <PlayerNavigation />
    {selectedReservation ? <ReservationDetails reservation={selectedReservation} onClose={() => setSelectedReservation(null)} /> : null}
  </main>;
}

function UpcomingReservations({ reservations, onSelect }: { reservations: Reservation[]; onSelect: (reservation: Reservation) => void }) {
  if (!reservations.length) return <UpcomingEmptyState />;
  const [nextReservation, ...remaining] = reservations;
  return <><p className="reservation-section-label mt-6">Próximo jogo</p><NextReservationHero onSelect={() => onSelect(nextReservation)} reservation={nextReservation} />{remaining.length > 0 ? <section className="mt-7"><h2 className="reservation-section-label">Outros horários</h2><div className="mt-3 space-y-2.5">{remaining.map((reservation, index) => <CompactReservationCard index={index} key={reservation.id} onSelect={() => onSelect(reservation)} reservation={reservation} />)}</div></section> : null}</>;
}

function NextReservationHero({ reservation, onSelect }: { reservation: Reservation; onSelect: () => void }) {
  const date = reservationDateParts(reservation.start_at);
  return <button aria-label={`Ver detalhes da reserva em ${reservation.arena_name}`} className={`reservation-hero-ticket reservation-agenda-reveal mt-3 w-full overflow-hidden rounded-[24px] text-left ${reservation.status === 'confirmed' ? 'is-confirmed' : ''}`} onClick={onSelect} type="button"><div aria-hidden="true" className="reservation-hero-image" /><div aria-hidden="true" className="reservation-hero-overlay" /><div className="relative z-10 flex min-h-[232px] flex-col p-5"><p className="reservation-hero-date">{date.weekday}, {date.day} {date.month}</p><p className="reservation-hero-time mt-3">{formatTimeBR(reservation.start_at)}</p><p className="mt-1 text-xs font-semibold text-[#C3CDD7]">até {formatTimeBR(reservation.end_at)}</p><div className="mt-auto"><h2 className="truncate text-[22px] font-extrabold tracking-[-.04em]">{reservation.arena_name}</h2><p className="mt-1 text-sm font-medium text-[#C3CDD7]">Quadra {reservation.court_name}</p><div className="mt-4 flex items-center justify-between gap-3"><StatusBadge status={reservation.status} /><span className="text-sm font-extrabold text-white">{formatCurrencyBRL(reservation.price)}</span></div></div></div><ChevronIcon /></button>;
}

function CompactReservationCard({ reservation, onSelect, index }: { reservation: Reservation; onSelect: () => void; index: number }) {
  const date = reservationDateParts(reservation.start_at);
  return <button aria-label={`Ver detalhes da reserva em ${reservation.arena_name}`} className={`reservation-compact-card reservation-agenda-stagger flex w-full items-center gap-4 rounded-[18px] p-3.5 text-left ${reservation.status === 'confirmed' ? 'is-confirmed' : ''}`} onClick={onSelect} style={{ '--reservation-index': index } as CSSProperties} type="button"><span className="reservation-compact-date"><strong>{date.day}</strong><small>{date.month}</small></span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{formatTimeBR(reservation.start_at)} · {reservation.arena_name}</b><small className="mt-1 block truncate text-xs text-[#9DA7B3]">Quadra {reservation.court_name}</small></span><StatusBadge compact status={reservation.status} /><ChevronIcon /></button>;
}

function ReservationHistory({ reservations, onSelect }: { reservations: Reservation[]; onSelect: (reservation: Reservation) => void }) {
  if (!reservations.length) return <div className="reservation-history-empty mt-9 text-center"><HistoryIcon /><h2 className="mt-4 text-lg font-extrabold">Nenhum jogo por aqui ainda.</h2></div>;
  const groups = new Map<string, Reservation[]>();
  reservations.forEach((reservation) => { const label = monthFormatter.format(new Date(reservation.start_at)).toUpperCase(); groups.set(label, [...(groups.get(label) ?? []), reservation]); });
  return <div className="mt-7 space-y-7">{[...groups.entries()].map(([month, group]) => <section key={month}><h2 className="reservation-section-label">{month}</h2><div className="mt-3 space-y-2.5">{group.map((reservation, index) => <CompactReservationCard index={index} key={reservation.id} onSelect={() => onSelect(reservation)} reservation={reservation} />)}</div></section>)}</div>;
}

function StatusBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const labels: Record<string, string> = { pending: 'Aguardando arena', confirmed: 'Confirmada', cancelled: 'Cancelada', completed: 'Concluída', no_show: 'Não compareceu' };
  const isPending = status === 'pending'; const isConfirmed = status === 'confirmed';
  return <span className={`reservation-status-badge ${compact ? 'is-compact' : ''} is-${status}`}><i aria-hidden="true" className={isPending ? 'is-pending' : ''}>{isConfirmed ? '✓' : null}</i><span>{labels[status] ?? status}</span></span>;
}

function UpcomingEmptyState() { return <section className="reservation-empty-state mt-9 rounded-[22px] border border-white/10 bg-[#111923]/85 p-7 text-center"><span aria-hidden="true" className="reservation-empty-ball"><BallIcon /></span><h2 className="mt-4 text-xl font-extrabold tracking-[-.035em]">Agenda livre</h2><p className="mt-2 text-sm text-[#9DA7B3]">Que tal marcar o próximo jogo?</p><a className="mt-6 inline-flex min-h-12 items-center justify-center rounded-2xl bg-[#8FFF3C] px-5 text-sm font-extrabold text-[#080D14]" href="/buscar">Buscar arenas <span className="ml-2 text-lg">→</span></a></section>; }
function ReservationsSkeleton() { return <div className="mt-7 space-y-4"><div className="h-3 w-24 animate-pulse rounded bg-white/10" /><div className="h-[232px] animate-pulse rounded-[24px] bg-[#111923]" /><div className="h-3 w-32 animate-pulse rounded bg-white/10" /><div className="h-[98px] animate-pulse rounded-[18px] bg-[#111923]" /></div>; }

function ReservationDetails({ reservation, onClose }: { reservation: Reservation; onClose: () => void }) { return <div aria-labelledby="reservation-details-title" aria-modal="true" className="fixed inset-0 z-40 flex items-end bg-black/60 p-3 backdrop-blur-sm sm:items-center sm:justify-center" role="dialog"><button aria-label="Fechar detalhes" className="absolute inset-0" onClick={onClose} type="button" /><section className="relative w-full max-w-md rounded-[24px] border border-white/10 bg-[#111923] p-5 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="reservation-section-label">Detalhes da reserva</p><h2 className="mt-2 text-xl font-extrabold" id="reservation-details-title">{reservation.arena_name}</h2></div><button aria-label="Fechar" className="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-xl text-[#C3CDD7]" onClick={onClose} type="button">×</button></div><div className="mt-5 space-y-3 border-y border-white/10 py-4 text-sm"><p className="flex justify-between gap-4"><span className="text-[#9DA7B3]">Quadra</span><b>{reservation.court_name}</b></p><p className="flex justify-between gap-4"><span className="text-[#9DA7B3]">Horário</span><b>{formatReservationTimeRange(reservation.start_at, reservation.end_at)}</b></p><p className="flex justify-between gap-4"><span className="text-[#9DA7B3]">Valor</span><b>{formatCurrencyBRL(reservation.price)}</b></p></div><div className="mt-4"><StatusBadge status={reservation.status} /></div></section></div>; }

function isUpcoming(reservation: Reservation, now: number) { return new Date(reservation.start_at).getTime() >= now && ['pending', 'confirmed'].includes(reservation.status); }
function reservationDateParts(value: string) { return formatReservationDateParts(value); }
function CalendarIcon() { return <svg fill="none" height="22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="22"><rect height="16" rx="3" width="18" x="3" y="5" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>; }
function ChevronIcon() { return <svg aria-hidden="true" className="reservation-card-chevron" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>; }
function BallIcon() { return <svg fill="none" height="34" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="34"><circle cx="12" cy="12" r="9" /><path d="m8 4 4 3 4-3M3.5 10l3 2.5-1 4M20.5 10l-3 2.5 1 4M8.5 20l3.5-3 3.5 3M6.5 12.5h5.5l2.5-4" /></svg>; }
function HistoryIcon() { return <svg aria-hidden="true" fill="none" height="36" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="36"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5M12 7v5l3 2" /></svg>; }
