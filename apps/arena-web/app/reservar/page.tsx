'use client';

import { FormEvent, Suspense, useRef, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArenaMedia } from '../../components/arena-media';
import { useAuth } from '../../components/use-auth';
import { apiRequest } from '../../lib/api';
import { formatCurrencyBRL, formatReservationDateParts, formatReservationTimeRange, formatTimeBR, todayInSaoPaulo } from '../../lib/format';
import { usePageReadyResource } from '../../providers/page-ready-provider';

const PENDING_RESERVATION_KEY = 'playarena_pending_reservation';
const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
type ReservationIntent = { arena: string; arenaId?: string; logoPath?: string; court: string; courtId: string; sport: string; startAt: string; endAt: string; price: string; duration: string };
type CreatedReservation = { start_at?: string; end_at?: string; price?: string | number; status?: string };

function storedIntent(): ReservationIntent | null { if (typeof window === 'undefined') return null; try { return JSON.parse(window.sessionStorage.getItem(PENDING_RESERVATION_KEY) ?? 'null') as ReservationIntent | null; } catch { return null; } }
function friendlyDate(value: string) { const [year, month, day] = value.slice(0, 10).split('-').map(Number); if (!year || !month || !day) return 'Data a confirmar'; return value.slice(0, 10) === todayInSaoPaulo() ? `Hoje, ${String(day).padStart(2, '0')} de ${monthNames[month - 1]}` : `${String(day).padStart(2, '0')} de ${monthNames[month - 1]} de ${year}`; }

function ReservationPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { session, profile, isLoading, refreshProfile } = useAuth();
  const [intent] = useState<ReservationIntent>(() => {
    const fromSearch = { arena: params.get('arena') ?? '', arenaId: params.get('arenaId') ?? undefined, logoPath: params.get('logoPath') ?? undefined, court: params.get('court') ?? '', courtId: params.get('courtId') ?? '', sport: params.get('sport') ?? '', startAt: params.get('startAt') ?? '', endAt: params.get('endAt') ?? '', price: params.get('price') ?? '', duration: params.get('duration') ?? '60' };
    return fromSearch.courtId ? fromSearch : storedIntent() ?? fromSearch;
  });
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState(false);
  const [createdReservation, setCreatedReservation] = useState<CreatedReservation | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionLock = useRef(false);
  const validIntent = Boolean(intent.arena && intent.court && intent.courtId && intent.startAt && intent.endAt && intent.price);
  const profileName = profile?.full_name?.trim() ?? '';
  const profilePhone = profile?.phone?.trim() ?? '';
  const profileComplete = Boolean(profileName && profilePhone);
  const profileError = Boolean(session && !isLoading && !profile);
  usePageReadyResource('reservation-intent', validIntent && !isLoading);

  function savePendingIntent() { window.sessionStorage.setItem(PENDING_RESERVATION_KEY, JSON.stringify(intent)); }
  function completeProfile() { savePendingIntent(); router.push(`/player/perfil?returnTo=${encodeURIComponent('/reservar')}`); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validIntent || isSubmitting || submissionLock.current) return;
    if (!session) { savePendingIntent(); router.push('/login?returnTo=/reservar'); return; }
    if (isLoading || !profile) { setError('Não foi possível carregar seus dados.'); return; }
    if (!profileComplete) { completeProfile(); return; }
    if (profile.role !== 'player') { setError('Esta conta não pode solicitar pré-reserva.'); return; }
    submissionLock.current = true; setIsSubmitting(true); setError(''); setConflict(false);
    try {
      const created = await apiRequest<CreatedReservation>('/player/reservations', session.access_token, { method: 'POST', body: JSON.stringify({ court_id: intent.courtId, start_at: intent.startAt, customer_name: profileName, customer_phone: profilePhone }) });
      setCreatedReservation(created); window.sessionStorage.removeItem(PENDING_RESERVATION_KEY); setSuccess(true);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : '';
      if (message.includes('acabou de ser reservado')) setConflict(true); else setError('Não foi possível solicitar a pré-reserva. Tente novamente.');
    } finally { submissionLock.current = false; setIsSubmitting(false); }
  }

  if (!validIntent) return <main className="min-h-[100dvh] bg-[#080D14] px-5 py-8 text-white"><section className="mx-auto max-w-md rounded-[20px] border border-white/10 bg-[#111923] p-6 text-center"><h1 className="text-2xl font-black">Reserva indisponível</h1><p className="mt-3 text-sm text-[#9DA7B3]">Escolha um horário novamente para continuar.</p><button className="mt-6 min-h-14 w-full rounded-2xl bg-[#8FFF3C] font-black text-[#080D14]" onClick={() => router.push('/buscar')} type="button">Buscar arenas</button></section></main>;
  if (success) return <Success created={createdReservation} intent={intent} />;

  return <main className="min-h-[100dvh] bg-[#080D14] pb-28 text-white"><div className="mx-auto max-w-[640px] px-4 py-5 sm:px-5"><header className="grid grid-cols-[44px_1fr_44px] items-center"><button aria-label="Voltar aos resultados" className="grid min-h-11 place-items-center rounded-xl text-2xl text-[#9DA7B3]" onClick={() => router.back()} type="button">‹</button><h1 className="text-center text-xl font-black">Pré-reserva</h1><span /></header><ReservationDetails intent={intent} /><form className="mt-6" noValidate onSubmit={(event) => void submit(event)}>{isLoading ? <ProfileSkeleton /> : !session ? <p className="px-1 text-sm font-semibold text-[#9DA7B3]">Entre para continuar</p> : profileError ? <section className="rounded-[20px] border border-[#FF4B4B]/25 bg-[#111923] p-5"><p className="font-bold text-[#FFB3B3]">Não foi possível carregar seus dados.</p><button className="mt-3 text-sm font-bold text-[#8FFF3C]" onClick={() => void refreshProfile()} type="button">Tentar novamente</button></section> : !profileComplete ? <section className="rounded-[20px] border border-[#8FFF3C]/20 bg-[#111923] p-5"><h2 className="text-lg font-black">Complete seus dados para continuar.</h2><button className="mt-4 font-bold text-[#8FFF3C]" onClick={completeProfile} type="button">Completar perfil</button></section> : <ProfileData name={profileName} phone={profilePhone} />}{error ? <p className="mt-4 rounded-2xl border border-[#FF4B4B]/30 bg-[#FF4B4B]/10 p-4 text-sm font-semibold text-[#FFB3B3]">{error}</p> : null}{conflict ? <div className="mt-4 rounded-[18px] border border-[#FF4B4B]/30 bg-[#FF4B4B]/10 p-4"><p className="text-sm font-semibold text-[#FFB3B3]">Esse horário não está mais disponível.</p><button className="mt-3 font-bold text-[#8FFF3C]" onClick={() => router.push('/buscar/disponibilidade')} type="button">Escolher outro horário</button></div> : null}<div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#111923]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur"><div className="mx-auto max-w-[640px]">{session && !isLoading && !profileComplete ? <button className="min-h-14 w-full rounded-2xl bg-[#8FFF3C] px-5 font-black text-[#080D14]" onClick={completeProfile} type="button">Completar perfil</button> : <button className="min-h-14 w-full rounded-2xl bg-[#8FFF3C] px-5 font-black text-[#080D14] disabled:opacity-60" disabled={isSubmitting || conflict || isLoading || (Boolean(session) && profileError)} type="submit">{isSubmitting ? 'Solicitando...' : 'Solicitar pré-reserva'}</button>}</div></div></form></div></main>;
}

function ReservationDetails({ intent }: { intent: ReservationIntent }) { return <section className="mt-6 overflow-hidden rounded-[20px] border border-white/10 bg-[#111923]"><div className="grid grid-cols-[112px_1fr]"><ArenaMedia arena={{ name: intent.arena, logo_path: intent.logoPath }} className="min-h-32" critical prefer="logo" sport={intent.sport} variant="ticket" /><div className="p-4"><h2 className="text-lg font-black">{intent.arena}</h2><p className="mt-1 text-sm text-[#9DA7B3]">{intent.sport} · {intent.court}</p><div className="mt-4 space-y-2 text-sm"><p>{friendlyDate(intent.startAt)}</p><p>{formatReservationTimeRange(intent.startAt, intent.endAt)} ({intent.duration} min)</p><p className="font-black">{formatCurrencyBRL(intent.price)}</p></div></div></div></section>; }
function ProfileData({ name, phone }: { name: string; phone: string }) { return <section className="rounded-[20px] border border-white/10 bg-[#111923] p-5"><h2 className="text-lg font-black">Seus dados</h2><div className="mt-4 space-y-2 text-sm"><p className="font-bold">{name}</p><p className="text-[#9DA7B3]">{formatPhoneBR(phone)}</p></div></section>; }
function ProfileSkeleton() { return <section className="rounded-[20px] border border-white/10 bg-[#111923] p-5"><div className="h-5 w-24 animate-pulse rounded bg-[#18212D]" /><div className="mt-5 h-4 w-3/5 animate-pulse rounded bg-[#18212D]" /><div className="mt-3 h-4 w-2/5 animate-pulse rounded bg-[#18212D]" /></section>; }
function Success({ intent, created }: { intent: ReservationIntent; created: CreatedReservation | null }) {
  const router = useRouter();
  const startAt = created?.start_at ?? intent.startAt;
  const endAt = created?.end_at ?? intent.endAt;
  const price = created?.price ?? intent.price;
  const duration = durationLabel(intent.duration, startAt, endAt);
  const date = ticketDate(startAt);

  return <main className="reservation-success relative min-h-[100dvh] overflow-hidden bg-[#080D14] text-white" style={{ '--success-ambient': ambientForSport(intent.sport) } as CSSProperties}><div aria-hidden="true" className="reservation-success-bg fixed inset-0" /><div aria-hidden="true" className="reservation-success-field fixed inset-x-0 bottom-0" /><div aria-hidden="true" className="reservation-success-particles fixed inset-0"><i /><i /><i /><i /><i /><i /><i /><i /></div><div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col items-center px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-center"><SuccessOrb /><h1 className="success-reveal success-reveal-title mt-5 text-[28px] font-extrabold leading-none tracking-[-.06em]">Pré-reserva enviada</h1><p className="success-reveal success-reveal-status mt-3 flex items-center gap-2 text-sm font-semibold text-[#AAB7C5]"><span className="success-status-dot" />Aguardando a arena</p><ReservationTicket date={date} duration={duration} intent={intent} price={price} time={formatTimeBR(startAt)} /><StatusTrack confirmed={created?.status === 'confirmed'} /><div className="success-reveal success-reveal-actions mt-auto w-full pt-6"><button className="success-cta relative min-h-[58px] w-full overflow-hidden rounded-[29px] bg-[#8FFF3C] px-5 font-bold text-[#080D14]" onClick={() => router.push('/player/reservas')} type="button"><span className="relative z-10 flex items-center justify-center gap-2"><TicketIcon />Acompanhar reserva</span><i aria-hidden="true" className="success-cta-shine absolute inset-y-0 w-1/2" /></button><button className="mt-3 min-h-10 text-sm font-bold text-[#C3CDD7] transition hover:text-white" onClick={() => router.push(`/buscar?${new URLSearchParams({ sport: intent.sport }).toString()}`)} type="button">Buscar outro horário</button></div></div></main>;
}

function SuccessOrb() { return <div className="success-reveal success-orb-wrap relative mt-3 grid h-[84px] w-[84px] place-items-center"><i aria-hidden="true" className="success-ripple success-ripple-one" /><i aria-hidden="true" className="success-ripple success-ripple-two" /><div className="success-orb relative z-10 grid h-[84px] w-[84px] place-items-center rounded-full"><CheckIcon /></div><div aria-hidden="true" className="success-orb-particles"><i /><i /><i /><i /><i /><i /></div></div>; }
function ReservationTicket({ intent, date, time, duration, price }: { intent: ReservationIntent; date: { main: string; sub: string }; time: string; duration: string; price: string | number }) { return <section className="success-reveal success-ticket mt-7 w-full overflow-hidden rounded-[24px] border border-white/[.08] bg-[#111923]/88 text-left backdrop-blur-md"><div className="grid h-[160px] grid-cols-[104px_1fr]"><ArenaMedia arena={{ name: intent.arena, logo_path: intent.logoPath }} className="success-ticket-image" prefer="logo" priority sport={intent.sport} variant="ticket" /><div className="flex min-w-0 flex-col p-4"><div><p className="truncate text-lg font-extrabold tracking-[-.03em]">{intent.arena}</p><p className="mt-0.5 truncate text-sm text-[#AAB7C5]">{intent.court}</p></div><div className="mt-auto grid grid-cols-3 divide-x divide-white/[.08]"><TicketMetric main={date.main} sub={date.sub} /><TicketMetric main={time} sub={duration} /><TicketMetric main={formatCurrencyBRL(price)} sub="Total" /></div></div></div></section>; }
function TicketMetric({ main, sub }: { main: string; sub: string }) { return <div className="min-w-0 px-2 first:pl-0 last:pr-0"><p className="truncate text-[13px] font-black text-white">{main}</p><p className="mt-1 text-[9px] font-bold uppercase tracking-[.1em] text-[#9DA7B3]">{sub}</p></div>; }
function StatusTrack({ confirmed }: { confirmed: boolean }) { return <section className="success-reveal success-reveal-track mt-6 w-full"><div className="mx-auto flex max-w-[250px] items-center"><span className="success-track-node success-track-active"><CheckIcon /></span><span className={`h-px flex-1 ${confirmed ? 'bg-[#8FFF3C]/60' : 'bg-white/15'}`} /><span className={`success-track-node ${confirmed ? 'success-track-active' : ''}`}>{confirmed ? <CheckIcon /> : null}</span></div><div className="mx-auto mt-2 flex max-w-[286px] justify-between text-[10px] font-bold uppercase tracking-[.12em] text-[#AAB7C5]"><span className="text-[#8FFF3C]">Solicitada</span><span className={confirmed ? 'text-[#8FFF3C]' : ''}>Confirmada</span></div></section>; }
function ticketDate(value: string) { const { day, month, weekday } = formatReservationDateParts(value); return { main: `${day} ${month}`, sub: weekday }; }
function durationLabel(fallback: string, startAt: string, endAt: string) { const milliseconds = new Date(endAt).getTime() - new Date(startAt).getTime(); const minutes = Number.isFinite(milliseconds) && milliseconds > 0 ? Math.round(milliseconds / 60000) : Number(fallback); return minutes === 60 ? '1 hora' : `${minutes} min`; }
function ambientForSport(sport: string) { const key = sport.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); return key === 'beachtennis' || key === 'futevolei' ? 'rgba(222,157,75,.2)' : key === 'tenis' ? 'rgba(74,168,123,.2)' : key === 'volei' ? 'rgba(85,132,207,.18)' : 'rgba(143,255,60,.2)'; }
function CheckIcon() { return <svg aria-hidden="true" className="h-8 w-8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>; }
function TicketIcon() { return <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 7h14v12H5zM8 4v6M16 4v6M5 11h14" /></svg>; }
function formatPhoneBR(value: string) { const digits = value.replace(/\D/g, ''); if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`; if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`; return value; }

export default function Page() { return <Suspense fallback={<main className="min-h-[100dvh] bg-[#080D14] p-5 text-white"><div className="mx-auto h-72 max-w-md animate-pulse rounded-[20px] bg-[#111923]" /></main>}><ReservationPage /></Suspense>; }
