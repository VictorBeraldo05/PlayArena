'use client';

import Image from 'next/image';
import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PlayerBottomNav, usePlayerBottomNavigation } from '../../../components/player-bottom-nav';
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
  society: { label: 'Society', subtitle: 'Futebol society', image: '/img/sports/schedule/society.jpg', environment: 'field', ambient: 'rgba(70, 162, 61, .24)', secondary: 'rgba(143,255,60,.16)', objectPosition: 'center 60%' },
  beachtennis: { label: 'Beach Tennis', subtitle: 'Raquete e areia', image: '/img/sports/schedule/beach-tennis.jpg', environment: 'sand', ambient: 'rgba(224, 166, 80, .22)', secondary: 'rgba(143,255,60,.13)' },
  futevolei: { label: 'Futevôlei', subtitle: 'Areia e rede', image: '/img/sports/schedule/futevolei.jpg', environment: 'sand', ambient: 'rgba(219, 132, 71, .22)', secondary: 'rgba(143,255,60,.13)' },
  tenis: { label: 'Tênis', subtitle: 'Jogo de precisão', image: '/img/sports/schedule/tenis.jpg', environment: 'court', ambient: 'rgba(65, 146, 111, .22)', secondary: 'rgba(119,229,255,.12)' },
  volei: { label: 'Vôlei', subtitle: 'Quadra e rede', image: '/img/sports/schedule/volei.jpg', environment: 'court', ambient: 'rgba(81, 125, 198, .2)', secondary: 'rgba(143,255,60,.12)' },
};

const defaultVisual: ScheduleVisual = { label: 'Modalidade', subtitle: 'Seu jogo, sua arena', environment: 'default', ambient: 'rgba(70, 162, 61, .2)', secondary: 'rgba(143,255,60,.13)' };

export function AvailabilitySearchClient() {
  const router = useRouter();
  const showPlayerNavigation = usePlayerBottomNavigation();
  const params = useSearchParams();
  const city = params.get('city') ?? 'Piracicaba';
  const sport = params.get('sport') ?? '';
  const visual = visualForSport(sport);
  const today = useMemo(() => todayInSaoPaulo(), []);
  const [day, setDay] = useState(today);
  const [time, setTime] = useState('20:00');
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const times = visual.quickTimes ?? DEFAULT_TIMES;
  const period = periodForTime(time);

  function search(event: FormEvent) {
    event.preventDefault();
    router.push(`/buscar/resultados?${new URLSearchParams({ city, sport, day, time }).toString()}`);
  }

  return (
    <main className={`schedule-page min-h-[100dvh] overflow-x-hidden bg-[#080D14] text-white ${showPlayerNavigation ? 'pb-[calc(5.75rem+env(safe-area-inset-bottom))]' : 'pb-[env(safe-area-inset-bottom)]'}`} style={{ '--schedule-ambient': visual.ambient, '--schedule-secondary': visual.secondary } as CSSProperties}>
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
          <DateNavigator minDate={today} onSelect={setDay} selectedDate={day}/>

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
    <div className="absolute inset-x-0 bottom-0 z-[3] p-4"><p className="text-[13px] font-black uppercase tracking-[.13em] text-white">{visual.label}</p><p className="mt-0.5 text-[11px] text-[#D1DCE7]">{visual.subtitle}</p></div>
  </section>;
}

function DateNavigator({ minDate, selectedDate, onSelect }: { minDate: string; selectedDate: string; onSelect: (date: string) => void }) {
  const [visibleStart, setVisibleStart] = useState(() => stripStartFor(selectedDate, minDate));
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => monthStart(selectedDate));
  const touchStart = useRef<number | null>(null);
  const dates = Array.from({ length: 5 }, (_, index) => addDays(visibleStart, index));

  function select(date: string) { onSelect(date); setVisibleStart(stripStartFor(date, minDate)); }
  function shift(days: number) { setVisibleStart((current) => maxDate(minDate, addDays(current, days))); }
  function openCalendar() { setCalendarMonth(monthStart(selectedDate)); setCalendarOpen(true); }

  return <section aria-label="Escolha a data"><div className="grid grid-cols-[36px_1fr_36px_44px] items-center gap-1"><button aria-label="Mostrar datas anteriores" className="grid min-h-9 place-items-center rounded-xl text-[#AAB7C5] transition hover:bg-white/5 hover:text-white disabled:opacity-30" disabled={visibleStart <= minDate} onClick={() => shift(-5)} type="button"><ChevronIcon direction="left"/></button><p className="text-center text-[10px] font-black uppercase tracking-[.16em] text-[#D1D9E0]">{monthLabel(selectedDate)}</p><button aria-label="Mostrar próximas datas" className="grid min-h-9 place-items-center rounded-xl text-[#AAB7C5] transition hover:bg-white/5 hover:text-white" onClick={() => shift(5)} type="button"><ChevronIcon direction="right"/></button><button aria-label="Escolher data" className="grid min-h-11 place-items-center rounded-xl border border-white/10 bg-white/[.035] text-[#8FFF3C] transition hover:bg-[#8FFF3C]/10" onClick={openCalendar} type="button"><CalendarIcon/></button></div><div className="mt-2 grid grid-cols-5 gap-2" onTouchEnd={(event) => { if (touchStart.current === null) return; const delta = event.changedTouches[0].clientX - touchStart.current; touchStart.current = null; if (Math.abs(delta) > 32) shift(delta < 0 ? 5 : -5); }} onTouchStart={(event) => { touchStart.current = event.touches[0].clientX; }}>{dates.map((date) => <DateButton date={date} key={date} selected={date === selectedDate} today={date === minDate} onClick={() => select(date)}/>)}</div>{calendarOpen ? <CalendarSheet minDate={minDate} month={calendarMonth} onClose={() => setCalendarOpen(false)} onMonthChange={setCalendarMonth} onSelect={(date) => { select(date); setCalendarOpen(false); }} selectedDate={selectedDate}/> : null}</section>;
}

function DateButton({ date, today, selected, onClick }: { date: string; today: boolean; selected: boolean; onClick: () => void }) { const dateValue = dateAtNoon(date); const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: BRAZIL_TIME_ZONE }).format(dateValue).replace('.', '').toUpperCase(); const number = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', timeZone: BRAZIL_TIME_ZONE }).format(dateValue); return <button aria-pressed={selected} className={`schedule-date-button min-h-[66px] rounded-[16px] ${selected ? 'schedule-date-selected' : ''} ${today && !selected ? 'border-[#8FFF3C]/55' : ''}`} onClick={onClick} type="button"><span className="text-[10px] font-black uppercase tracking-[.08em]">{today ? 'Hoje' : weekday}</span><strong className="mt-1 block text-[21px] leading-none">{number}</strong>{selected ? <i aria-hidden="true" /> : null}</button>; }

function CalendarSheet({ minDate, month, selectedDate, onMonthChange, onSelect, onClose }: { minDate: string; month: string; selectedDate: string; onMonthChange: (month: string) => void; onSelect: (date: string) => void; onClose: () => void }) { useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [onClose]); const cells = calendarCells(month); const previousDisabled = month <= monthStart(minDate); return <div className="fixed inset-0 z-50 flex items-end bg-black/65 p-3 backdrop-blur-sm sm:items-center sm:justify-center"><button aria-label="Fechar calendário" className="absolute inset-0" onClick={onClose} type="button"/><section aria-modal="true" className="relative w-full max-w-md rounded-[24px] border border-white/10 bg-[#111923] p-5 shadow-2xl" role="dialog"><div className="flex items-center justify-between"><h2 className="text-xl font-bold text-white">Escolher data</h2><button autoFocus aria-label="Fechar" className="grid h-10 w-10 place-items-center rounded-xl text-xl text-[#AAB7C5]" onClick={onClose} type="button">×</button></div><div className="mt-5 grid grid-cols-[44px_1fr_44px] items-center"><button aria-label="Mês anterior" className="grid min-h-11 place-items-center text-[#AAB7C5] disabled:opacity-30" disabled={previousDisabled} onClick={() => onMonthChange(addMonths(month, -1))} type="button"><ChevronIcon direction="left"/></button><p className="text-center text-sm font-extrabold uppercase tracking-[.12em] text-white">{monthLabel(month)}</p><button aria-label="Próximo mês" className="grid min-h-11 place-items-center text-[#AAB7C5]" onClick={() => onMonthChange(addMonths(month, 1))} type="button"><ChevronIcon direction="right"/></button></div><div className="mt-5 grid grid-cols-7 gap-y-2 text-center text-[10px] font-black uppercase tracking-[.08em] text-[#9DA7B3]">{['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((label) => <span key={label}>{label}</span>)}</div><div className="mt-3 grid grid-cols-7 gap-y-1">{cells.map((date, index) => date ? <CalendarDay date={date} disabled={date < minDate} key={date} selected={date === selectedDate} today={date === minDate} onClick={() => onSelect(date)}/> : <span key={`blank-${index}`}/>)}</div></section></div>; }

function CalendarDay({ date, disabled, selected, today, onClick }: { date: string; disabled: boolean; selected: boolean; today: boolean; onClick: () => void }) { return <button aria-label={`Selecionar ${date}`} aria-pressed={selected} className={`mx-auto grid h-10 w-10 place-items-center rounded-full text-sm font-bold transition ${selected ? 'bg-[#8FFF3C] text-[#080D14]' : today ? 'border border-[#8FFF3C] text-white' : 'text-[#D7DEE7] hover:bg-white/[.08]'} disabled:cursor-not-allowed disabled:text-[#56616D]`} disabled={disabled} onClick={onClick} type="button">{date.slice(-2)}</button>; }

function normalizeSport(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function visualForSport(sport: string) { return scheduleSportVisuals[normalizeSport(sport)] ?? { ...defaultVisual, label: sport || defaultVisual.label }; }
function dateAtNoon(iso: string) { return new Date(`${iso}T12:00:00Z`); }
function addDays(iso: string, days: number) { const value = dateAtNoon(iso); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function addMonths(iso: string, months: number) { const [year, month] = iso.split('-').map(Number); const value = new Date(year, month - 1 + months, 1, 12); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-01`; }
function monthStart(iso: string) { return `${iso.slice(0, 7)}-01`; }
function maxDate(left: string, right: string) { return left > right ? left : right; }
function stripStartFor(date: string, minDate: string) { return maxDate(minDate, addDays(date, -2)); }
function calendarCells(month: string) { const first = dateAtNoon(month); const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: BRAZIL_TIME_ZONE }).format(first); const offset = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday); const [year, monthNumber] = month.split('-').map(Number); const count = new Date(year, monthNumber, 0).getDate(); return [...Array.from({ length: offset }, () => null), ...Array.from({ length: count }, (_, index) => `${month.slice(0, 7)}-${String(index + 1).padStart(2, '0')}`)]; }
function monthLabel(iso: string) { return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: BRAZIL_TIME_ZONE }).format(dateAtNoon(iso)).toUpperCase(); }
function summaryDate(iso: string) { return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: BRAZIL_TIME_ZONE }).format(dateAtNoon(iso)).replace('.', '').toUpperCase(); }
function periodForTime(value: string) { const hour = Number(value.slice(0, 2)); if (hour < 5) return 'Madrugada'; if (hour < 12) return 'Manhã'; if (hour < 18) return 'Tarde'; return 'Noite'; }

function ArrowLeftIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6M9 12h12" /></svg>; }
function ChevronIcon({ direction }: { direction: 'left' | 'right' }) { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} /></svg>; }
function CalendarIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><rect height="16" rx="2" width="18" x="3" y="5"/><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01"/></svg>; }
function PeriodIcon() { return <svg aria-hidden="true" className="h-4 w-4 text-[#8FFF3C]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /><circle cx="12" cy="12" r="4" /></svg>; }
