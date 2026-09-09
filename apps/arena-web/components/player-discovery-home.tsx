'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { formatCurrencyBRL } from '../lib/format';
import { PlayerBottomNav, usePlayerBottomNavigation } from './player-bottom-nav';
import { ArenaMedia } from './arena-media';
import { useAuth } from './use-auth';

type Sport = { id: number; name: string; slug: string };
type Arena = { id: string; name: string; city: string; description: string | null; logo_path?: string | null; court_count: number; sports: string[]; price_from: number | string | null };

export function PlayerDiscoveryHome() {
  const { profile } = useAuth();
  const showPlayerNavigation = usePlayerBottomNavigation();
  const [sports, setSports] = useState<Sport[]>([]);
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [query, setQuery] = useState('');
  const [selectedSport, setSelectedSport] = useState('');
  const [loading, setLoading] = useState(true);
  const [arenasError, setArenasError] = useState('');
  const [sportsError, setSportsError] = useState('');
  const city = 'Piracicaba';

  async function loadDiscovery() {
    setLoading(true);
    setArenasError('');
    setSportsError('');
    try {
      const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
      const [sportsResult, arenasResult] = await Promise.allSettled([
        fetch(`${base}/sports`, { cache: 'no-store' }),
        fetch(`${base}/arenas?city=${encodeURIComponent(city)}`, { cache: 'no-store' }),
      ]);
      if (sportsResult.status === 'fulfilled' && sportsResult.value.ok) setSports(await sportsResult.value.json() as Sport[]);
      else { setSports([]); setSportsError('Não foi possível carregar os esportes.'); }
      if (arenasResult.status === 'fulfilled' && arenasResult.value.ok) setArenas(await arenasResult.value.json() as Arena[]);
      else { setArenas([]); setArenasError('Não foi possível carregar as arenas.'); }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void Promise.resolve().then(loadDiscovery); }, []);

  const filteredArenas = useMemo(() => {
    const normalizedQuery = normalize(query);
    return arenas.filter((arena) => {
      const matchesSport = !selectedSport || arena.sports.some((sport) => normalize(sport) === normalize(selectedSport));
      const searchable = [arena.name, arena.description ?? '', ...arena.sports].join(' ');
      return matchesSport && (!normalizedQuery || normalize(searchable).includes(normalizedQuery));
    });
  }, [arenas, query, selectedSport]);
  const greetingName = profile?.full_name?.split(' ')[0];

  return <main className={`discovery-page min-h-[100dvh] bg-[#080D14] text-white ${showPlayerNavigation ? 'pb-[calc(5.75rem+env(safe-area-inset-bottom))]' : 'pb-[env(safe-area-inset-bottom)]'}`}>
    <div aria-hidden="true" className="discovery-haze fixed inset-x-0 top-0 h-[420px]" />
    <div className="relative mx-auto w-full max-w-[640px] px-4 pb-8 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-5">
      <header className="discovery-enter flex items-center justify-between gap-4">
        <div><p className="text-sm font-semibold text-[#AAB7C5]">{greetingName ? `Boa tarde, ${greetingName}` : 'Descubra onde jogar'}</p><h1 className="mt-2 text-[32px] font-extrabold leading-[.94] tracking-[-.06em]">Encontre sua<br />próxima <span className="text-[#8FFF3C]">arena.</span></h1></div>
        <span aria-hidden="true" className="discovery-avatar">{greetingName?.slice(0, 1).toUpperCase() ?? <UserIcon />}</span>
      </header>

      <label className="discovery-search discovery-enter mt-6 flex min-h-[56px] items-center gap-3 rounded-[18px] border border-white/10 bg-[#111923]/88 px-4 shadow-[0_14px_35px_rgba(0,0,0,.18)] backdrop-blur">
        <SearchIcon /><span className="sr-only">Buscar arena ou esporte</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Buscar arena ou esporte" type="search" value={query} />
      </label>
      <div className="discovery-location discovery-enter mt-3 inline-flex items-center gap-2 rounded-full border border-white/[.07] bg-white/[.035] px-3 py-2 text-xs font-bold text-[#D6DEE7]"><PinIcon /><span>{city}, SP</span><ChevronDownIcon /></div>
      {selectedSport ? <div className="mt-3"><button className="discovery-filter-chip" onClick={() => setSelectedSport('')} type="button">{selectedSport} <span aria-hidden="true">×</span></button></div> : null}

      <SectionHeading title="Perto de você" />
      {loading ? <ArenaCarouselSkeleton /> : null}
      {arenasError ? <InlineError message={arenasError} onRetry={() => void loadDiscovery()} /> : null}
      {!loading && !arenasError ? <div className="discovery-carousel -mr-4 mt-3 flex snap-x gap-3 overflow-x-auto pb-2 pr-4 sm:-mr-5 sm:pr-5">{filteredArenas.slice(0, 6).map((arena) => <ArenaCarouselCard arena={arena} key={arena.id} />)}</div> : null}

      <SectionHeading title="Explore esportes" />
      {sportsError ? <InlineError message={sportsError} onRetry={() => void loadDiscovery()} /> : <div className="discovery-sports -mr-4 mt-3 flex gap-3 overflow-x-auto pb-2 pr-4 sm:-mr-5 sm:pr-5">{sports.map((sport) => <SportBubble active={selectedSport === sport.name} key={sport.id} onClick={() => setSelectedSport(selectedSport === sport.name ? '' : sport.name)} sport={sport} />)}</div>}

      <SectionHeading title={`Arenas em ${city}`} />
      {loading ? <ArenaListSkeleton /> : null}
      {arenasError ? <InlineError message={arenasError} onRetry={() => void loadDiscovery()} /> : null}
      {!loading && !arenasError && filteredArenas.length === 0 ? <section className="discovery-empty mt-3 rounded-[20px] border border-white/10 bg-[#111923]/80 p-5 text-center"><p className="font-bold">Nenhuma arena de {selectedSport || 'esporte'} por aqui ainda.</p><button className="mt-3 text-sm font-bold text-[#8FFF3C]" onClick={() => { setSelectedSport(''); setQuery(''); }} type="button">Ver todos os esportes</button></section> : null}
      {!loading && !arenasError ? <div className="mt-3 space-y-3">{filteredArenas.map((arena) => <ArenaListCard arena={arena} key={arena.id} />)}</div> : null}
    </div>
    <PlayerBottomNav />
  </main>;
}

function SectionHeading({ title }: { title: string }) { return <div className="mt-7 flex items-center justify-between"><h2 className="text-[11px] font-black uppercase tracking-[.16em] text-[#D6DEE7]">{title}</h2></div>; }
function ArenaCarouselSkeleton() { return <div className="discovery-carousel mt-3 flex gap-3 overflow-hidden"><div className="h-[196px] w-[246px] shrink-0 animate-pulse rounded-[21px] bg-[#111923]" /><div className="h-[196px] w-[246px] shrink-0 animate-pulse rounded-[21px] bg-[#111923]" /></div>; }
function ArenaListSkeleton() { return <div className="mt-3 space-y-3"><div className="h-[130px] animate-pulse rounded-[20px] bg-[#111923]" /><div className="h-[130px] animate-pulse rounded-[20px] bg-[#111923]" /></div>; }
function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) { return <section className="mt-3 rounded-[18px] border border-[#FF4B4B]/20 bg-[#FF4B4B]/10 p-4 text-sm"><p className="font-semibold text-[#FFCCCC]">{message}</p><button className="mt-2 font-bold text-[#8FFF3C]" onClick={onRetry} type="button">Tentar novamente</button></section>; }

function ArenaCarouselCard({ arena }: { arena: Arena }) { return <Link className="discovery-carousel-card group w-[246px] shrink-0 snap-start overflow-hidden rounded-[21px] border border-white/10 bg-[#111923]" href={`/player/arenas/${arena.id}`}><ArenaMedia arena={arena} className="h-[112px]" priority sport={arena.sports[0]} /><div className="p-3.5"><h3 className="truncate text-base font-extrabold">{arena.name}</h3><p className="mt-1 truncate text-xs text-[#AAB7C5]">{arena.sports.join(' • ') || 'Modalidades em breve'} • {arena.court_count} {arena.court_count === 1 ? 'campo' : 'campos'}</p>{arena.price_from ? <p className="mt-3 text-sm font-black text-[#8FFF3C]">A partir de {formatCurrencyBRL(arena.price_from)}/h</p> : null}</div></Link>; }
function ArenaListCard({ arena }: { arena: Arena }) { const sport = arena.sports[0] ?? ''; return <Link className="discovery-list-card group flex overflow-hidden rounded-[20px] border border-white/10 bg-[#111923]" href={`/player/arenas/${arena.id}`}><ArenaMedia arena={arena} className="h-[126px] w-[126px] shrink-0" sport={sport} variant="thumbnail" /><div className="flex min-w-0 flex-1 flex-col p-4"><h3 className="truncate text-lg font-extrabold tracking-[-.03em]">{arena.name}</h3><p className="mt-1 truncate text-sm text-[#AAB7C5]">{sport || 'Modalidades em breve'} • {arena.court_count} {arena.court_count === 1 ? 'campo' : 'campos'}</p><div className="mt-auto flex items-center justify-between gap-2"><span className="text-sm font-black text-[#8FFF3C]">{arena.price_from ? `A partir de ${formatCurrencyBRL(arena.price_from)}/h` : ''}</span><span className="discovery-card-arrow"><ArrowRightIcon /></span></div></div></Link>; }
function SportBubble({ sport, active, onClick }: { sport: Sport; active: boolean; onClick: () => void }) { return <button aria-pressed={active} className={`discovery-sport-bubble ${active ? 'is-active' : ''}`} onClick={onClick} type="button"><span className="discovery-sport-image"><ArenaMedia arena={{ name: sport.name }} sport={sport.slug} variant="thumbnail" /></span><span>{sport.name}</span></button>; }
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function SearchIcon() { return <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-[#8FFF3C]" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>; }
function PinIcon() { return <svg aria-hidden="true" className="h-4 w-4 text-[#8FFF3C]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2" /></svg>; }
function ChevronDownIcon() { return <svg aria-hidden="true" className="h-3.5 w-3.5 text-[#9DA7B3]" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>; }
function ArrowRightIcon() { return <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24"><path d="m5 12h14m-5-5 5 5-5 5" /></svg>; }
function UserIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.5 3.1-5.2 7-5.2s6.2 1.7 7 5.2" /></svg>; }
