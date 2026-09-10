'use client';

import Image from 'next/image';
import { Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PlayerBottomNav, usePlayerBottomNavigation } from '../../components/player-bottom-nav';
import { PlayerDiscoveryHome } from '../../components/player-discovery-home';
import { PageReadyGate } from '../../providers/page-ready-provider';
import { trackEvent } from '../../lib/analytics';

type Sport = { id: number; name: string; slug: string };
type VisualSpec = { label: string; detail: string; accent: string; image?: string };

const ORBIT_ORDER = ['beach-tennis', 'futevolei', 'tenis', 'volei'] as const;

const sportVisuals: Record<string, VisualSpec> = {
  society: { label: 'Society', detail: 'Futebol society', accent: '#8FFF3C', image: '/img/sports/society.png' },
  beachtennis: { label: 'Beach Tennis', detail: 'Raquete e areia', accent: '#FFD66B', image: '/img/sports/beach-tenis.png' },
  futevolei: { label: 'Futevôlei', detail: 'Areia e rede', accent: '#FF9A5A', image: '/img/sports/futevolei.png' },
  tenis: { label: 'Tênis', detail: 'Jogo de precisão', accent: '#7DE8FF', image: '/img/sports/tenis1.png' },
  volei: { label: 'Vôlei', detail: 'Quadra e rede', accent: '#C9B6FF', image: '/img/sports/volei.png' },
};

export default function SearchPage() {
  return <PlayerDiscoveryHome />;
}

export function NewReservationPage() {
  return <Suspense fallback={<SearchFallback />}><SearchContent /></Suspense>;
}

function SearchContent() {
  const router = useRouter();
  const showPlayerNavigation = usePlayerBottomNavigation();
  const params = useSearchParams();
  const [sports, setSports] = useState<Sport[]>([]);
  const [sport, setSport] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const city = params.get('city')?.trim() || 'Piracicaba';

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
        const response = await fetch(`${apiUrl}/sports`, { cache: 'no-store' });
        if (!response.ok) throw new Error('sports_fetch_failed');
        const data: Sport[] = await response.json();
        if (!active) return;
        setSports(data);
        const requestedSport = params.get('sport');
        setSport(
          data.find((item) => item.name === requestedSport)?.name ??
            data.find((item) => item.slug === requestedSport)?.name ??
            data.find((item) => item.slug === 'society')?.name ??
            data[0]?.name ??
            '',
        );
        if (!data.length) setError('Nenhuma modalidade disponível.');
      } catch {
        if (!active) return;
        setSports([]);
        setError('Não foi possível carregar as modalidades.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [params]);

  const selectedSport = sports.find((item) => item.name === sport) ?? null;
  const selectedVisual = selectedSport ? visualForSport(selectedSport) : null;
  const orbitSports = useMemo(
    () => ORBIT_ORDER.map((slug) => sports.find((item) => item.slug === slug)).filter((item): item is Sport => Boolean(item)),
    [sports],
  );
  const anchorSports = useMemo(() => {
    const society = sports.find((item) => item.slug === 'society');
    return society ? [society, ...orbitSports] : orbitSports;
  }, [orbitSports, sports]);
  const visibleSports = useMemo(() => selectedSport ? [selectedSport, ...anchorSports.filter((item) => item.id !== selectedSport.id)] : anchorSports, [anchorSports, selectedSport]);
  const extraSports = useMemo(
    () => sports.filter((item) => item.id !== selectedSport?.id && !ORBIT_ORDER.includes(item.slug as (typeof ORBIT_ORDER)[number]) && item.slug !== 'society'),
    [selectedSport?.id, sports],
  );

  function continueFlow() {
    if (!sport || loading) return;
    trackEvent('search_started', { properties: { city, sport, source: 'new_reservation' }, dedupeKey: `search-started:${city}:${sport}` });
    router.push(`/buscar/disponibilidade?city=${encodeURIComponent(city)}&sport=${encodeURIComponent(sport)}`);
  }

  return (
    <main className={`new-reservation-page search-orbit landing-night relative h-[100dvh] min-h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#080D14] text-white ${showPlayerNavigation ? 'pb-[calc(4rem+env(safe-area-inset-bottom))]' : 'pb-[env(safe-area-inset-bottom)]'}`}>
      <PageReadyGate ready={!loading} resourceId="sports" />
      <Image alt="Arena noturna com gramado iluminado" className="landing-night-image absolute inset-0 z-0 object-cover object-center opacity-40" fill priority sizes="100vw" src="/img/playarena-hero.png" />
      <div aria-hidden="true" className="landing-night-haze landing-night-haze-left absolute z-[2]" />
      <div aria-hidden="true" className="landing-night-haze landing-night-haze-right absolute z-[2]" />
      <div aria-hidden="true" className="landing-night-beam landing-night-beam-left absolute z-[3]" />
      <div aria-hidden="true" className="landing-night-beam landing-night-beam-right absolute z-[3]" />
      <div aria-hidden="true" className="landing-night-sweep absolute z-[3]" />
      <div aria-hidden="true" className="landing-night-particles absolute inset-0 z-[4]"><i /><i /><i /><i /><i /><i /><i /><i /></div>
      <div aria-hidden="true" className="landing-night-overlay absolute inset-0 z-[6]" />
      <div aria-hidden="true" className="landing-night-field absolute inset-x-0 bottom-0 z-[6]" />
      <div aria-hidden="true" className="search-stadium absolute inset-x-0 bottom-0 z-[7]" />

      <div className="new-reservation-content relative z-10 mx-auto flex h-full w-full max-w-[470px] flex-col px-5 pt-[max(.7rem,env(safe-area-inset-top))]">
        <button aria-label="Voltar" className="landing-reveal landing-reveal-brand flex min-h-11 w-fit items-center gap-2 text-base font-bold text-[#D7DEE7] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8FFF3C]" onClick={() => router.back()} type="button"><ArrowLeftIcon /> Voltar</button>

        <header className="landing-reveal landing-reveal-one mt-4">
          <h1 className="text-[clamp(2.25rem,10vw,2.5rem)] font-extrabold leading-[.98] tracking-[-.06em]">Onde você<br />quer <span className="text-[#8FFF3C]">jogar?</span></h1>
          <div className="mt-5 flex h-[78px] w-full items-center rounded-[18px] border border-[#8FFF3C]/15 bg-[#111923]/82 px-5 shadow-[inset_0_1px_0_rgba(255,255,255,.04)] backdrop-blur-md">
            <PinIcon />
            <div className="ml-4 min-w-0 flex-1"><strong className="block text-lg leading-5">{city}</strong><span className="mt-1 block text-sm text-[#AAB7C5]">São Paulo</span></div>
            <ChevronRightIcon />
          </div>
        </header>

        <section className="landing-reveal landing-reveal-two mt-7">
          <h2 className="text-[1.7rem] font-extrabold tracking-[-.045em]">O que vamos jogar?</h2>
          <p className="mt-1 max-w-[310px] text-[15px] leading-5 text-[#9EACBA]">Escolha sua modalidade e encontre arenas incríveis.</p>
          <div className="new-reservation-orbit search-orbit-stage relative mt-1 w-full overflow-hidden" aria-label="Seletor de modalidade">
            <div aria-hidden="true" className="search-orbit-haze absolute inset-x-[10%] top-[28%]" />
            <div aria-hidden="true" className="search-orbit-spotlight absolute left-1/2 top-1/2" />
            <OrbitPaths />
            {loading ? <div className="relative z-10 flex h-full items-center justify-center"><p className="text-sm text-[#AEB8C5]">Carregando modalidades...</p></div> : error ? <div className="relative z-10 flex h-full flex-col items-center justify-center text-center"><p className="text-sm text-[#FFB3B3]">{error}</p><button className="mt-3 text-sm font-bold text-[#8FFF3C] underline" onClick={() => window.location.reload()} type="button">Tentar novamente</button></div> : selectedSport && selectedVisual ? <>
              <SportOrb visual={selectedVisual} position="center" selected onClick={() => setSport(selectedSport.name)} />
              {visibleSports.slice(1, 5).map((item, index) => <SportOrb key={item.id} position={`node-${index + 1}` as OrbitPosition} selected={false} visual={visualForSport(item)} onClick={() => setSport(item.name)} />)}
            </> : null}
          </div>
          {extraSports.length > 0 ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{extraSports.map((item) => <button aria-label={`Selecionar ${item.name}`} aria-pressed={false} className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 text-xs font-semibold text-[#C9D2DB] transition hover:border-[#8FFF3C]/45 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8FFF3C]" key={item.id} onClick={() => setSport(item.name)} type="button">{item.name}</button>)}</div> : null}
          <p className="mt-3 text-center text-sm leading-5 text-[#AAB7C5]">Toque em um esporte<br />para continuar</p>
        </section>

        <div className="landing-reveal landing-reveal-cta relative z-10 mt-7 pb-2"><button className="landing-night-cta search-orbit-cta relative min-h-[62px] w-full overflow-hidden rounded-[32px] bg-[#8FFF3C] px-6 text-lg font-bold text-[#080D14] disabled:cursor-not-allowed disabled:opacity-60" disabled={!sport || loading} onClick={continueFlow} type="button"><span className="relative z-10 flex items-center justify-center gap-3">Continuar <span aria-hidden="true" className="search-orbit-arrow text-xl">-&gt;</span></span><i aria-hidden="true" className="landing-night-cta-light absolute inset-y-0 w-1/2" /></button></div>
      </div>
      <PlayerBottomNav />
    </main>
  );
}

function SearchFallback() {
  return <main className="min-h-[100dvh] bg-[#080D14]" />;
}

type OrbitPosition = 'center' | 'node-1' | 'node-2' | 'node-3' | 'node-4';

function SportOrb({ visual, position, selected, onClick }: { visual: VisualSpec; position: OrbitPosition; selected: boolean; onClick: () => void }) {
  return <button aria-label={`Selecionar ${visual.label}`} aria-pressed={selected} className={`search-orbit-orb search-orbit-${position} ${selected ? 'search-orbit-selected' : ''} ${visual.image ? 'search-orbit-has-image' : ''}`} onClick={onClick} style={{ '--sport-accent': visual.accent } as CSSProperties} type="button"><span className="search-orbit-orb-disc">{visual.image ? <Image alt={visual.label} className="search-orbit-sport-image" height={160} priority={selected} sizes={selected ? '132px' : '86px'} src={visual.image} width={160} /> : <SportGlyph accent={visual.accent} large={selected} />}</span><strong className="search-orbit-orb-label">{visual.label}</strong><span className="search-orbit-orb-detail">{visual.detail}</span>{selected ? <span aria-hidden="true" className="search-orbit-check"><CheckIcon /></span> : null}</button>;
}

function OrbitPaths() {
  return <svg aria-hidden="true" className="search-orbit-paths absolute inset-0 h-full w-full" viewBox="0 0 350 340"><ellipse cx="175" cy="171" fill="none" rx="160" ry="116" stroke="rgba(143,255,60,.18)" strokeWidth="1.25" /><ellipse cx="175" cy="171" fill="none" rx="126" ry="81" stroke="rgba(143,255,60,.18)" strokeDasharray="5 8" strokeWidth="1.25" transform="rotate(-12 175 171)" /><circle className="search-orbit-energy search-orbit-energy-one" cx="68" cy="262" r="4" /><circle className="search-orbit-energy search-orbit-energy-two" cx="300" cy="112" r="4" /><circle className="search-orbit-energy search-orbit-energy-three" cx="177" cy="52" r="3.5" /></svg>;
}

function SportGlyph({ accent, large }: { accent: string; large: boolean }) {
  const size = large ? 'h-11 w-11' : 'h-8 w-8';
  const stroke = { fill: 'none', stroke: accent, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.7 };
  return <svg aria-hidden="true" className={size} viewBox="0 0 24 24" {...stroke}><circle cx="12" cy="12" r="8" /><path d="M5 12h14M12 5a11 11 0 0 1 0 14M12 5a11 11 0 0 0 0 14" /></svg>;
}

function PinIcon() { return <svg aria-hidden="true" className="h-5 w-5 text-[#8FFF3C]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2" /></svg>; }
function ArrowLeftIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6M9 12h12" /></svg>; }
function ChevronRightIcon() { return <svg aria-hidden="true" className="h-6 w-6 text-white" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>; }
function CheckIcon() { return <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>; }
function visualForSport(sport: Sport): VisualSpec {
  return sportVisuals[normalizeSport(sport.slug)] ?? sportVisuals[normalizeSport(sport.name)] ?? fallbackVisual(sport);
}

function normalizeSport(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fallbackVisual(sport: Sport): VisualSpec { return { label: sport.name, detail: 'Modalidade', accent: '#8FFF3C' }; }
