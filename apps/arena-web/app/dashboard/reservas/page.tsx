'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { OwnerGuard } from '../../../components/owner-guard';
import { OwnerNavigation } from '../../../components/owner-navigation';
import { useAuth } from '../../../components/use-auth';
import { apiRequest } from '../../../lib/api';
import { BRAZIL_TIME_ZONE, formatCurrencyBRL, formatTimeBR } from '../../../lib/format';

type Reservation = { id: string; customer_name: string; court_name: string; start_at: string; end_at: string; price: string; status: string; source: string };
type Period = 'today' | 'week' | 'all';
type Action = 'confirm' | 'cancel';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: BRAZIL_TIME_ZONE });
const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: BRAZIL_TIME_ZONE });

export default function ReservationsPage() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [items, setItems] = useState<Reservation[] | null>(null);
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState<Period>('week');
  const [notice, setNotice] = useState('');
  const [acting, setActing] = useState<Action | null>(null);
  const [activeId, setActiveId] = useState('');
  const [now] = useState(() => new Date());
  const lock = useRef(false);

  async function refresh(accessToken = token) {
    if (!accessToken) return;
    try { setItems(await apiRequest<Reservation[]>('/owner/reservations', accessToken, { cache: 'no-store' })); }
    catch { setNotice('Não foi possível carregar as reservas.'); setItems([]); }
  }

  useEffect(() => {
    if (!token) return;
    const accessToken = token;
    let active = true;
    void (async () => {
      try {
        const data = await apiRequest<Reservation[]>('/owner/reservations', accessToken, { cache: 'no-store' });
        if (active) setItems(data);
      } catch {
        if (active) { setNotice('Não foi possível carregar as reservas.'); setItems([]); }
      }
    })();
    return () => { active = false; };
  }, [token]);

  async function updateStatus(reservation: Reservation, next: Action) {
    if (!token || lock.current) return;
    lock.current = true;
    setActiveId(reservation.id);
    setActing(next);
    try {
      await apiRequest(`/owner/reservations/${reservation.id}/${next}`, token, { method: 'POST' });
      setNotice(next === 'confirm' ? 'Reserva confirmada.' : 'Reserva recusada.');
      await refresh(token);
      window.dispatchEvent(new Event('playarena:reservations-changed'));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      setNotice(message.includes('acabou de ser reservado') ? 'Esse horário não está mais disponível.' : 'Não foi possível atualizar a reserva.');
    } finally {
      lock.current = false;
      setActiveId('');
      setActing(null);
    }
  }

  const visible = (items ?? []).filter((reservation) => matchesPeriod(reservation, period, now) && (status === 'all' || reservation.status === status));
  const pending = visible.filter((reservation) => reservation.status === 'pending').sort(sortByStart);
  const confirmed = visible.filter((reservation) => reservation.status === 'confirmed').sort(sortByStart);
  const remaining = visible.filter((reservation) => !['pending', 'confirmed'].includes(reservation.status)).sort(sortByStart);

  return <OwnerGuard><main className="owner-reservations-page min-h-[100dvh] bg-[#080D14] pb-28 text-white"><div aria-hidden="true" className="owner-reservations-ambient fixed inset-x-0 top-0 h-[270px]" /><div className="relative mx-auto w-full max-w-[640px] px-4 pb-6 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-5">
    <header className="owner-reservation-enter flex items-center justify-between gap-4"><h1 className="text-[28px] font-extrabold tracking-[-.055em]">Reservas</h1>{pending.length > 0 ? <span className="owner-pending-summary">{pending.length} {pending.length === 1 ? 'pendente' : 'pendentes'}</span> : null}</header>
    <section aria-label="Filtros de reservas" className="owner-reservation-enter mt-6 flex items-center gap-2"><div className="owner-period-filter grid flex-1 grid-cols-3">{([['today', 'Hoje'], ['week', 'Semana'], ['all', 'Todas']] as const).map(([value, label]) => <button aria-pressed={period === value} className={period === value ? 'is-active' : ''} key={value} onClick={() => setPeriod(value)} type="button">{label}</button>)}</div><label className="owner-status-filter"><span className="sr-only">Filtrar por status</span><select onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">Status</option><option value="pending">Pendente</option><option value="confirmed">Confirmada</option><option value="cancelled">Cancelada</option><option value="completed">Concluída</option><option value="no_show">Não compareceu</option></select></label></section>
    {notice ? <p aria-live="polite" className="owner-reservation-notice mt-4">{notice}</p> : null}
    {items === null ? <ReservationsSkeleton /> : visible.length === 0 ? <EmptyState /> : <div className="mt-6 space-y-7">
      {pending.length > 0 ? <ReservationSection count={pending.length} label="Pendentes"><div className="space-y-3">{pending.map((reservation, index) => <PendingReservationCard active={activeId === reservation.id} index={index} key={reservation.id} onUpdate={updateStatus} reservation={reservation} action={acting} />)}</div></ReservationSection> : null}
      {confirmed.length > 0 ? <ReservationSection label="Confirmadas"><div className="space-y-2.5">{confirmed.map((reservation, index) => <SimpleReservationCard index={index} key={reservation.id} reservation={reservation} />)}</div></ReservationSection> : null}
      {remaining.length > 0 ? <GroupedReservations reservations={remaining} /> : null}
    </div>}
  </div><OwnerNavigation /></main></OwnerGuard>;
}

function ReservationSection({ label, count, children }: { label: string; count?: number; children: ReactNode }) { return <section><h2 className="owner-reservation-section-label">{label}{count ? <span>{count}</span> : null}</h2>{children}</section>; }

function PendingReservationCard({ reservation, index, active, action, onUpdate }: { reservation: Reservation; index: number; active: boolean; action: Action | null; onUpdate: (reservation: Reservation, action: Action) => Promise<void> }) {
  return <article className="owner-pending-card owner-reservation-stagger rounded-[20px] p-4" style={{ '--reservation-index': index } as CSSProperties}><div className="flex items-start justify-between gap-4"><div><p className="owner-reservation-date">{dateLabel(reservation.start_at)}</p><p className="owner-reservation-time mt-1">{formatTimeBR(reservation.start_at)}</p><p className="text-xs font-semibold text-[#9DA7B3]">até {formatTimeBR(reservation.end_at)}</p></div><strong className="pt-1 text-sm">{formatCurrencyBRL(reservation.price)}</strong></div><div className="mt-3"><h3 className="text-base font-extrabold">{reservation.customer_name}</h3><p className="mt-1 text-sm text-[#AAB7C5]">{reservation.court_name}</p></div><div className="mt-3 flex items-center justify-between gap-3"><StatusBadge status="pending" /><span className="owner-source-badge">{sourceLabel(reservation.source)}</span></div><div className="mt-4 grid grid-cols-2 gap-2"><button aria-label={`Confirmar reserva de ${reservation.customer_name}`} className="owner-confirm-button" disabled={active} onClick={() => void onUpdate(reservation, 'confirm')} type="button">{active && action === 'confirm' ? 'Confirmando...' : 'Confirmar'}</button><button aria-label={`Recusar reserva de ${reservation.customer_name}`} className="owner-reject-button" disabled={active} onClick={() => void onUpdate(reservation, 'cancel')} type="button">{active && action === 'cancel' ? 'Recusando...' : 'Recusar'}</button></div></article>;
}

function SimpleReservationCard({ reservation, index }: { reservation: Reservation; index: number }) { return <article className="owner-simple-card owner-reservation-stagger flex items-center gap-3 rounded-[17px] p-3.5" style={{ '--reservation-index': index } as CSSProperties}><div className="min-w-[57px]"><p className="owner-reservation-date">{dateLabel(reservation.start_at)}</p><strong className="mt-1 block text-lg tracking-[-.05em]">{formatTimeBR(reservation.start_at)}</strong></div><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-extrabold">{reservation.customer_name}</h3><p className="mt-1 truncate text-xs text-[#9DA7B3]">{reservation.court_name}</p></div><StatusBadge status={reservation.status} /></article>; }

function GroupedReservations({ reservations }: { reservations: Reservation[] }) {
  const groups = new Map<string, Reservation[]>();
  reservations.forEach((reservation) => { const label = dateLabel(reservation.start_at); groups.set(label, [...(groups.get(label) ?? []), reservation]); });
  return <div className="space-y-7">{[...groups.entries()].map(([label, group]) => <ReservationSection key={label} label={label}><div className="space-y-2.5">{group.map((reservation, index) => <SimpleReservationCard index={index} key={reservation.id} reservation={reservation} />)}</div></ReservationSection>)}</div>;
}

function StatusBadge({ status }: { status: string }) { const labels: Record<string, string> = { pending: 'Aguardando', confirmed: 'Confirmada', cancelled: 'Cancelada', completed: 'Concluída', no_show: 'Não compareceu' }; return <span className={`owner-status-badge is-${status}`}><i aria-hidden="true">{status === 'confirmed' ? '✓' : null}</i>{labels[status] ?? status}</span>; }
function EmptyState() { return <section className="owner-reservations-empty mt-8 rounded-[20px] border border-white/10 bg-[#111923] p-7 text-center"><CalendarIcon /><h2 className="mt-4 text-lg font-extrabold">Nenhuma reserva neste período.</h2></section>; }
function ReservationsSkeleton() { return <div className="mt-7 space-y-3"><div className="h-3 w-28 animate-pulse rounded bg-white/10" /><div className="h-[170px] animate-pulse rounded-[20px] bg-[#111923]" /><div className="h-[170px] animate-pulse rounded-[20px] bg-[#111923]" /></div>; }
function dateLabel(value: string) { const key = dayKeyFormatter.format(new Date(value)); const today = dayKeyFormatter.format(new Date()); if (key === today) return 'Hoje'; return dateFormatter.format(new Date(value)).replace('.', '').toUpperCase(); }
function matchesPeriod(reservation: Reservation, period: Period, now: Date) { if (period === 'all') return true; const target = dayKeyFormatter.format(new Date(reservation.start_at)); const today = dayKeyFormatter.format(now); if (period === 'today') return target === today; const start = new Date(now); start.setDate(start.getDate() + 6); return target >= today && target <= dayKeyFormatter.format(start); }
function sortByStart(left: Reservation, right: Reservation) { return new Date(left.start_at).getTime() - new Date(right.start_at).getTime(); }
function sourceLabel(source: string) { return source === 'app' ? 'Via app' : source === 'arena_manual' ? 'Manual' : source; }
function CalendarIcon() { return <svg aria-hidden="true" fill="none" height="34" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 24 24" width="34"><rect height="16" rx="3" width="18" x="3" y="5" /><path d="M8 3v4M16 3v4M3 10h18" /></svg>; }
