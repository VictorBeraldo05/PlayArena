'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { ArenaMedia } from '../../../../components/arena-media';
import { PlayerBottomNav } from '../../../../components/player-bottom-nav';
import { formatCurrencyBRL } from '../../../../lib/format';

type Court = { id: string; name: string; default_duration_minutes: number; sports: string[]; price_from: string | null };
type OpeningHour = { weekday: number; open_time: string; close_time: string };
type Arena = { name: string; description: string | null; logo_path?: string | null; address: string; city: string; state: string; phone: string | null; whatsapp: string | null; courts: Court[]; opening_hours: OpeningHour[] };

const week = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];

export default function ArenaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [arena, setArena] = useState<Arena | null>(null);
  const [error, setError] = useState('');
  const [showWeek, setShowWeek] = useState(false);

  const loadArena = useCallback(() => {
    setError('');
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
    void fetch(`${base}/arenas/${id}`)
      .then((response) => response.ok ? response.json() as Promise<Arena> : Promise.reject())
      .then(setArena)
      .catch(() => setError('Não foi possível carregar esta arena.'));
  }, [id]);

  useEffect(() => { const timer = window.setTimeout(loadArena, 0); return () => window.clearTimeout(timer); }, [loadArena]);

  if (error) return <ErrorState onBack={() => router.back()} onRetry={loadArena} />;
  if (!arena) return <ArenaSkeleton />;

  const primarySport = arena.courts.flatMap((court) => court.sports)[0] ?? '';
  const todayHours = arena.opening_hours.filter((hour) => hour.weekday === new Date().getDay());
  const bookingHref = `/nova-reserva?${new URLSearchParams({ sport: primarySport }).toString()}`;

  return <main className="min-h-[100dvh] bg-[#080D14] pb-44 text-white">
    <section className="relative h-[252px] overflow-hidden rounded-b-[28px] bg-[#111923]">
      <ArenaMedia arena={arena} className="absolute inset-0" priority sport={primarySport} variant="hero" />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-[#080D14]/45 via-transparent to-[#080D14]/95" />
      <button aria-label="Voltar" className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] grid h-11 w-11 place-items-center rounded-full bg-[#080D14]/65 text-xl backdrop-blur" onClick={() => router.back()} type="button">←</button>
    </section>
    <div className="mx-auto w-full max-w-[640px] px-5">
      <header className="relative -mt-14"><h1 className="text-[32px] font-extrabold leading-none tracking-[-.06em]">{arena.name}</h1><p className="mt-3 text-sm font-semibold text-[#C3CDD7]">{primarySport || 'Modalidades'} <span className="mx-1.5 text-[#8FFF3C]">•</span> {arena.city}</p><div className="mt-4 flex flex-wrap gap-2"><Fact label={`${arena.courts.length} ${arena.courts.length === 1 ? 'campo' : 'campos'}`} /><Fact label={primarySport || 'Arena'} /></div></header>
      {arena.description ? <Section title="Sobre a arena"><p className="text-[15px] leading-6 text-[#C3CDD7]">{arena.description}</p></Section> : null}
      <Section title="Campos"><div className="space-y-3">{arena.courts.map((court) => <CourtCard arena={arena} court={court} key={court.id} />)}</div></Section>
      <Section title="Horários"><div className="flex items-center justify-between border-b border-white/10 pb-4"><div><p className="text-sm font-bold">Hoje</p><p className="mt-1 text-sm text-[#AAB7C5]">{formatHours(todayHours)}</p></div><button className="text-sm font-bold text-[#8FFF3C]" onClick={() => setShowWeek(!showWeek)} type="button">{showWeek ? 'Ocultar semana' : 'Ver semana'} ›</button></div>{showWeek ? <div className="mt-4 space-y-2 text-sm">{week.map((label, index) => <div className="flex justify-between" key={label}><span className="font-bold text-[#D7DEE7]">{label}</span><span className="text-[#AAB7C5]">{formatHours(arena.opening_hours.filter((hour) => hour.weekday === index))}</span></div>)}</div> : null}</Section>
      {(arena.address || arena.phone || arena.whatsapp) ? <Section title="Informações"><div className="space-y-4 text-sm"><InfoRow icon={<PinIcon />} value={`${arena.address}${arena.address ? ', ' : ''}${arena.city} - ${arena.state}`} />{arena.whatsapp || arena.phone ? <InfoRow icon={<PhoneIcon />} value={formatPhone(arena.whatsapp || arena.phone || '')} /> : null}</div></Section> : null}
    </div>
    <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 px-4"><Link className="mx-auto flex min-h-14 max-w-[640px] items-center justify-center rounded-[26px] bg-[#8FFF3C] px-5 text-base font-extrabold text-[#080D14] shadow-[0_12px_30px_rgba(0,0,0,.35)]" href={bookingHref}>Ver horários disponíveis <span className="ml-2 text-lg">→</span></Link></div><PlayerBottomNav />
  </main>;
}

function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="mt-9"><h2 className="text-[11px] font-black uppercase tracking-[.16em] text-[#D7DEE7]">{title}</h2><div className="mt-4">{children}</div></section>; }
function Fact({ label }: { label: string }) { return <span className="rounded-full border border-white/10 bg-white/[.045] px-3 py-2 text-xs font-bold text-[#D7DEE7]">{label}</span>; }
function CourtCard({ arena, court }: { arena: Arena; court: Court }) { const sport = court.sports[0] ?? ''; const href = `/nova-reserva?${new URLSearchParams({ sport }).toString()}`; return <article className="rounded-[20px] border border-white/10 bg-[#111923] p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-extrabold">{court.name}</h3><p className="mt-1 text-sm text-[#AAB7C5]">{sport || 'Modalidade'} • {court.default_duration_minutes} min</p></div><ArenaMedia arena={arena} className="h-11 w-11 rounded-xl" sport={sport} variant="thumbnail" /></div>{court.price_from ? <p className="mt-5 text-sm font-black text-[#8FFF3C]">A partir de {formatCurrencyBRL(court.price_from)}/h</p> : null}<Link className="mt-4 flex items-center justify-between border-t border-white/10 pt-3 text-sm font-bold text-white" href={href}>Ver horários <span className="text-[#8FFF3C]">›</span></Link></article>; }
function InfoRow({ icon, value }: { icon: ReactNode; value: string }) { return <div className="flex items-start gap-3 text-[#C3CDD7]"><span className="mt-0.5 text-[#8FFF3C]">{icon}</span><span>{value}</span></div>; }
function ArenaSkeleton() { return <main className="min-h-[100dvh] bg-[#080D14] text-white"><div className="h-[252px] animate-pulse rounded-b-[28px] bg-[#111923]" /><div className="mx-auto -mt-10 max-w-[640px] px-5"><div className="h-8 w-1/2 animate-pulse rounded bg-[#18212D]" /><div className="mt-4 h-4 w-1/3 animate-pulse rounded bg-[#18212D]" /><div className="mt-10 h-40 animate-pulse rounded-[20px] bg-[#111923]" /></div><PlayerBottomNav /></main>; }
function ErrorState({ onBack, onRetry }: { onBack: () => void; onRetry: () => void }) { return <main className="min-h-[100dvh] bg-[#080D14] px-5 pt-6 text-white"><button className="text-sm font-bold text-[#D7DEE7]" onClick={onBack} type="button">← Voltar</button><section className="mt-16 text-center"><h1 className="text-xl font-extrabold">Não foi possível carregar esta arena.</h1><button className="mt-5 rounded-2xl bg-[#8FFF3C] px-5 py-3 font-bold text-[#080D14]" onClick={onRetry} type="button">Tentar novamente</button></section><PlayerBottomNav /></main>; }
function formatHours(hours: OpeningHour[]) { return hours.length ? hours.map((hour) => `${hour.open_time.slice(0, 5)}–${hour.close_time.slice(0, 5)}`).join(' • ') : 'Fechado'; }
function formatPhone(value: string) { const digits = value.replace(/\D/g, ''); return digits.length === 11 ? `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}` : digits.length === 10 ? `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}` : value; }
function PinIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2" /></svg>; }
function PhoneIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M5 4h3l1.5 4-2 1.5a15 15 0 0 0 7 7l1.5-2 4 1.5v3c0 1-1 1.8-2 1.7C10 20.1 3.9 14 3.3 6 3.2 5 4 4 5 4Z" /></svg>; }
