'use client';

import Image from 'next/image';
import { FormEvent, useMemo, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PlayerBottomNav } from '../../../components/player-bottom-nav';
import { BRAZIL_TIME_ZONE, todayInSaoPaulo } from '../../../lib/format';

const DEFAULT_TIMES = ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'];

type ScheduleVisual = {
  label: string;
  subtitle: string;
  image?: string;
  environment: 'field' | 'sand' | 'court' | 'default';
  ambient: string;
  secondary: string;
  objectPosition?: string;
  quickTimes?: string[];
};

// These public URLs intentionally work before the optional schedule assets are added.
const scheduleSportVisuals: Record<string, ScheduleVisual> = {
  society: { label: 'Society', subtitle: 'Futebol society', image: '/img/sports/schedule/society.jpg', environment: 'field', ambient: 'rgba(70, 162, 61, .24)', secondary: 'rgba(143,255,60,.16)' },
  beachtennis: { label: 'Beach Tennis', subtitle: 'Raquete e areia', image: '/img/sports/schedule/beach-tennis.jpg', environment: 'sand', ambient: 'rgba(224, 166, 80, .22)', secondary: 'rgba(143,255,60,.13)' },
  futevolei: { label: 'Futevôlei', subtitle: 'Areia e rede', image: '/img/sports/schedule/futevolei.jpg', environment: 'sand', ambient: 'rgba(219, 132, 71, .22)', secondary: 'rgba(143,255,60,.13)' },
  tenis: { label: 'Tênis', subtitle: 'Jogo de precisão', image: '/img/sports/schedule/tenis.jpg', environment: 'court', ambient: 'rgba(65, 146, 111, .22)', secondary: 'rgba(119,229,255,.12)' },
  volei: { label: 'Vôlei', subtitle: 'Quadra e rede', image: '/img/sports/schedule/volei.jpg', environment: 'court', ambient: 'rgba(81, 125, 198, .2)', secondary: 'rgba(143,255,60,.12)' },
};

const defaultVisual: ScheduleVisual = { label: 'Modalidade', subtitle: 'Seu jogo, sua arena', environment: 'default', ambient: 'rgba(70, 162, 61, .2)', secondary: 'rgba(143,255,60,.13)' };

export function AvailabilitySearchClient() {
  const router = useRouter();
  const params = useSearchParams();
  const city = params.get('city') ?? 'Piracicaba';
  const sport = params.get('sport') ?? '';
  const visual = visualForSport(sport);
  const [day, setDay] = useState(todayInSaoPaulo);
  const [time, setTime] = useState('20:00');
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const days = useMemo(() => nextDays(todayInSaoPaulo()), []);
  const times = visual.quickTimes ?? DEFAULT_TIMES;
  const period = periodForTime(time);

  function search(event: FormEvent) {
    event.preventDefault();
    router.push(`/buscar/resultados?${new URLSearchParams({ city, sport, day, time }).toString()}`);
  }

  return (
    <main className="schedule-page min-h-[100dvh] overflow-x-hidden bg-[#080D14] pb-[calc(5.75rem+env(safe-area-inset-bottom))] text-white" style={{ '--schedule-ambient': visual.ambient, '--schedule-secondary': visual.secondary } as CSSProperties}>
      <div aria-hidden="true" className="schedule-background fixed inset-0" />
      <div aria-hidden="true" className="schedule-particles fixed inset-0"><i /><i /><i /><i /><i /><i /><i /><i /></div>

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[520px] flex-col px-5 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-[max(.75rem,env(safe-area-inset-top))] sm:px-6">
        <header className="schedule-reveal flex items-center justify-between">
          <button aria-label="Voltar para escolher modalidade" className="flex min-h-9 items-center gap-2 text-sm font-bold text-[#D7DEE7] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8FFF3C]" onClick={() => router.push(`/nova-reserva?${new URLSearchParams({ city, sport }).toString()}`)} type="button"><ArrowLeftIcon /> Voltar</button>
          <span className="text-xs font-bold uppercase tracking-[.18em] text-[#96A4B3]">2 de 3</span>
        </header>

        <section className="schedule-reveal schedule-reveal-one mt-4">
          <h1 className="text-[clamp(2rem,8.7vw,2.125rem)] font-extrabold leading-[.99] tracking-[-.06em]">Quando a bola<br /><span className="text-[#8FFF3C]">vai rolar?</span></h1>
        </section>

        <form className="schedule-reveal schedule-reveal-two mt-5" onSubmit={search}>
          <section aria-label="Escolha a data">
            <div className="flex items-center gap-2"><span className="h-px flex-1 bg-white/10" /><p className="text-[10px] font-black uppercase tracking-[.16em] text-[#D1D9E0]">{monthLabel(day)}</p><span className="h-px flex-1 bg-white/10" /></div>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {days.map((item, index) => <DateButton date={item} index={index} key={item} selected={day === item} onClick={() => setDay(item)} />)}
            </div>
          </section>

          <SportHero imageFailed={heroImageFailed} key={sport} onImageError={() => setHeroImageFailed(true)} visual={visual} />

          <section className="mt-4" aria-label="Escolha o horário">
            <div className="flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-[.2em] text-[#AAB7C5]">Horário do jogo</p><div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-[#D4DCE5]"><PeriodIcon /><span>{period}</span></div></div>
            <div className="schedule-time-display mt-1 text-[clamp(2.4rem,11vw,2.75rem)] font-extrabold leading-none tracking-[-.07em] text-[#8FFF3C]" key={time}>{time}</div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {times.map((value) => <button aria-pressed={time === value} className={`schedule-time-chip min-h-11 rounded-[15px] text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8FFF3C] ${time === value ? 'schedule-time-selected' : ''}`} key={value} onClick={() => setTime(value)} type="button"><span>{value}</span>{time === value ? <i aria-hidden="true" /> : null}</button>)}
            </div>
          </section>

          <div className="schedule-summary mt-3 flex min-h-[34px] items-center justify-center gap-2 whitespace-nowrap rounded-[14px] border border-white/10 bg-[#0D1720]/78 px-3 text-[10px] font-bold uppercase tracking-[.08em] text-[#D4DCE5] backdrop-blur-md">
            <span>{summaryDate(day)}</span><span className="text-white/35">•</span><span>{visual.label}</span><span className="text-white/35">•</span><span className="text-[#8FFF3C]">{time}</span>
          </div>

          <button className="schedule-cta relative mt-3 min-h-14 w-full overflow-hidden rounded-[26px] bg-[#8FFF3C] px-6 text-base font-bold text-[#080D14]" type="submit"><span className="relative z-10 flex items-center justify-center gap-3">Ver arenas disponíveis <span aria-hidden="true" className="schedule-cta-arrow">-&gt;</span></span><i aria-hidden="true" className="schedule-cta-shine absolute inset-y-0 w-1/2" /></button>
        </form>
      </div>
      <PlayerBottomNav />
    </main>
  );
}

function SportHero({ visual, imageFailed, onImageError }: { visual: ScheduleVisual; imageFailed: boolean; onImageError: () => void }) {
  return <section className={`schedule-sport-hero schedule-environment-${visual.environment} relative mt-4 h-40 overflow-hidden rounded-[20px] border border-white/10`}>
    {visual.image && !imageFailed ? <Image alt={`${visual.label} em arena esportiva`} className="schedule-hero-image absolute inset-0 h-full w-full object-cover" fill onError={onImageError} priority sizes="(max-width: 520px) 100vw, 520px" src={visual.image} style={{ objectPosition: visual.objectPosition ?? 'center' }} /> : null}
    <div aria-hidden="true" className="schedule-hero-fallback absolute inset-0" />
    <div aria-hidden="true" className="schedule-hero-overlay absolute inset-0" />
    <div className="absolute inset-x-0 bottom-0 z-[2] p-4"><p className="text-[13px] font-black uppercase tracking-[.13em] text-white">{visual.label}</p><p className="mt-0.5 text-[11px] text-[#D1DCE7]">{visual.subtitle}</p></div>
  </section>;
}

function DateButton({ date, index, selected, onClick }: { date: string; index: number; selected: boolean; onClick: () => void }) {
  const dateValue = dateAtNoon(date);
  const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: BRAZIL_TIME_ZONE }).format(dateValue).replace('.', '').toUpperCase();
  const number = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', timeZone: BRAZIL_TIME_ZONE }).format(dateValue);
  return <button aria-label={`Selecionar ${date}`} aria-pressed={selected} className={`schedule-date-button min-h-[66px] rounded-[16px] ${selected ? 'schedule-date-selected' : ''}`} onClick={onClick} type="button"><span className="text-[10px] font-black uppercase tracking-[.08em]">{index === 0 ? 'Hoje' : weekday}</span><strong className="mt-1 block text-[21px] leading-none">{number}</strong>{selected ? <i aria-hidden="true" /> : null}</button>;
}

function normalizeSport(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function visualForSport(sport: string) { return scheduleSportVisuals[normalizeSport(sport)] ?? { ...defaultVisual, label: sport || defaultVisual.label }; }
function dateAtNoon(iso: string) { return new Date(`${iso}T12:00:00Z`); }
function nextDays(today: string) { return Array.from({ length: 5 }, (_, index) => { const value = dateAtNoon(today); value.setUTCDate(value.getUTCDate() + index); return value.toISOString().slice(0, 10); }); }
function monthLabel(iso: string) { return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: BRAZIL_TIME_ZONE }).format(dateAtNoon(iso)).toUpperCase(); }
function summaryDate(iso: string) { return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: BRAZIL_TIME_ZONE }).format(dateAtNoon(iso)).replace('.', '').toUpperCase(); }
function periodForTime(value: string) { const hour = Number(value.slice(0, 2)); if (hour < 5) return 'Madrugada'; if (hour < 12) return 'Manhã'; if (hour < 18) return 'Tarde'; return 'Noite'; }

function ArrowLeftIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6M9 12h12" /></svg>; }
function PeriodIcon() { return <svg aria-hidden="true" className="h-4 w-4 text-[#8FFF3C]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /><circle cx="12" cy="12" r="4" /></svg>; }
