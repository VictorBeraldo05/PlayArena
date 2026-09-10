'use client';

import Image from 'next/image';
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { formatTimeBR } from '../lib/format';
import { useAuth } from './use-auth';

type Mode = 'login' | 'signup';
type ReservationIntent = { arena: string; court: string; sport: string; startAt: string; price?: string; customerName?: string; customerPhone?: string };

const PENDING_RESERVATION_KEY = 'playarena_pending_reservation';
const sportImages: Record<string, string> = {
  society: '/img/sports/society.png',
  beachtennis: '/img/sports/beach-tenis.png',
  futevolei: '/img/sports/futevolei.png',
  tenis: '/img/sports/tenis1.png',
  volei: '/img/sports/volei.png',
};

export function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const safeReturnTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : null;
  const { signIn, signUp, errorMessage, clearError, session, isLoading, profile, ownedArenas } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [intent] = useState<ReservationIntent | null>(storedIntent);
  const [imageFailed, setImageFailed] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submissionLock = useRef(false);

  useEffect(() => {
    if (!isLoading && session) {
      if (profile?.role === 'player') {
        router.replace(safeReturnTo ?? '/buscar');
        return;
      }
      if (profile?.role === 'arena_owner' && ownedArenas.length === 0) {
        router.replace('/onboarding');
        return;
      }
      router.replace(safeReturnTo ?? '/dashboard');
    }
  }, [isLoading, ownedArenas.length, profile?.role, router, safeReturnTo, session]);

  function changeMode(nextMode: Mode) {
    if (isSubmitting) return;
    clearError();
    setInfoMessage(null);
    setMode(nextMode);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting || submissionLock.current) return;
    clearError();
    setInfoMessage(null);

    if (mode === 'signup' && password !== confirmPassword) {
      setInfoMessage('As senhas precisam coincidir.');
      return;
    }

    submissionLock.current = true;
    setIsSubmitting(true);
    let success = false;
    try {
      if (mode === 'login') {
        success = await signIn(email.trim(), password);
      } else {
        success = await signUp({ fullName: fullName.trim(), phone: phone.trim(), email: email.trim(), password });
        if (success) setInfoMessage('Conta criada. Verifique seu e-mail para continuar.');
      }
    } finally {
      if (!success) {
        submissionLock.current = false;
        setIsSubmitting(false);
      }
    }
  }

  const image = intent ? sportImages[normalizeSport(intent.sport)] : undefined;
  const ambient = ambientForSport(intent?.sport ?? '');

  return (
    <main className="login-page relative min-h-[100dvh] overflow-x-hidden bg-[#080D14] text-white" style={{ '--login-ambient': ambient } as CSSProperties}>
      <div aria-hidden="true" className="login-atmosphere fixed inset-0" />
      <div aria-hidden="true" className="login-field fixed inset-x-0 bottom-0" />
      <div aria-hidden="true" className="login-particles fixed inset-0"><i /><i /><i /><i /><i /><i /></div>

      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[460px] flex-col px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
        <button aria-label="Voltar" className="login-reveal flex min-h-9 w-fit items-center gap-2 text-sm font-bold text-[#D7DEE7] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8FFF3C]" onClick={() => router.back()} type="button"><ArrowLeftIcon /> Voltar</button>
        <h1 className="login-reveal login-reveal-one mt-5 text-[clamp(2rem,9vw,2.35rem)] font-extrabold leading-[.98] tracking-[-.06em]">Entre para continuar</h1>

        {intent ? <ReservationSummary image={image} imageFailed={imageFailed} intent={intent} onImageError={() => setImageFailed(true)} /> : null}

        <section className="login-reveal login-reveal-three mt-6">
          <div className="login-segment relative grid grid-cols-2 rounded-[15px] border border-white/10 bg-[#111923]/78 p-1 backdrop-blur-md">
            <span aria-hidden="true" className={`login-segment-indicator ${mode === 'signup' ? 'login-segment-signup' : ''}`} />
            <button aria-pressed={mode === 'login'} className={`relative z-10 min-h-10 rounded-[11px] text-sm font-bold transition ${mode === 'login' ? 'text-[#080D14]' : 'text-[#9DA7B3]'}`} onClick={() => changeMode('login')} type="button">Entrar</button>
            <button aria-pressed={mode === 'signup'} className={`relative z-10 min-h-10 rounded-[11px] text-sm font-bold transition ${mode === 'signup' ? 'text-[#080D14]' : 'text-[#9DA7B3]'}`} onClick={() => changeMode('signup')} type="button">Criar conta</button>
          </div>

          <form className="login-reveal login-reveal-four mt-5 space-y-3" onSubmit={handleSubmit}>
            {mode === 'signup' ? <><Field label="Nome completo" onChange={setFullName} type="text" value={fullName} /><Field label="Telefone" onChange={setPhone} type="tel" value={phone} /></> : null}
            <Field label="E-mail" onChange={setEmail} type="email" value={email} />
            <PasswordField label="Senha" onChange={setPassword} revealed={showPassword} setRevealed={setShowPassword} value={password} />
            {mode === 'signup' ? <PasswordField label="Confirmar senha" onChange={setConfirmPassword} revealed={showConfirmation} setRevealed={setShowConfirmation} value={confirmPassword} /> : null}
            {errorMessage ? <Banner message={friendlyError(errorMessage)} tone="error" /> : null}
            {infoMessage ? <Banner message={infoMessage} tone="info" /> : null}
            <button className="login-cta relative flex min-h-14 w-full items-center justify-center gap-2 overflow-hidden rounded-[22px] bg-[#8FFF3C] text-base font-bold text-[#080D14] disabled:cursor-not-allowed disabled:opacity-70" disabled={isSubmitting} type="submit"><span className="relative z-10">{isSubmitting ? (mode === 'login' ? 'Entrando...' : 'Criando conta...') : mode === 'login' ? 'Continuar' : 'Criar conta'}</span>{isSubmitting ? <span aria-hidden="true" className="relative z-10 h-4 w-4 animate-spin rounded-full border-2 border-[#080D14]/30 border-t-[#080D14]" /> : null}<i aria-hidden="true" className="login-cta-shine absolute inset-y-0 w-1/2" /></button>
          </form>
        </section>
      </div>
    </main>
  );
}

function ReservationSummary({ intent, image, imageFailed, onImageError }: { intent: ReservationIntent; image?: string; imageFailed: boolean; onImageError: () => void }) {
  return <section className="login-reveal login-reveal-two mt-5 flex min-h-[78px] items-center gap-3 rounded-[18px] border border-white/10 bg-[#111923]/72 p-3 backdrop-blur-md"><div className="login-reservation-image relative grid h-[54px] w-[54px] shrink-0 place-items-center overflow-hidden rounded-[13px]">{image && !imageFailed ? <Image alt={intent.sport} className="h-full w-full object-contain p-0.5" height={108} onError={onImageError} src={image} width={108} /> : <SportFallbackIcon />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{intent.arena || intent.sport}</p><p className="mt-1 truncate text-xs text-[#AAB7C5]">{[intent.court, reservationTime(intent.startAt)].filter(Boolean).join(' • ')}</p></div></section>;
}

function Field({ label, value, onChange, type }: { label: string; value: string; onChange: (value: string) => void; type: string }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#DDE4EC]">{label}</span><input className="login-input h-[52px] w-full rounded-[15px] px-4 text-base text-white outline-none" onChange={(event) => onChange(event.target.value)} required type={type} value={value} /></label>;
}

function PasswordField({ label, value, onChange, revealed, setRevealed }: { label: string; value: string; onChange: (value: string) => void; revealed: boolean; setRevealed: (value: boolean) => void }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-bold text-[#DDE4EC]">{label}</span><span className="relative block"><input className="login-input h-[52px] w-full rounded-[15px] px-4 pr-12 text-base text-white outline-none" onChange={(event) => onChange(event.target.value)} required type={revealed ? 'text' : 'password'} value={value} /><button aria-label={revealed ? 'Esconder senha' : 'Mostrar senha'} className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-xl text-[#AAB7C5] transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8FFF3C]" onClick={() => setRevealed(!revealed)} type="button"><EyeIcon hidden={revealed} /></button></span></label>;
}

function Banner({ message, tone }: { message: string; tone: 'error' | 'info' }) { return <p className={`rounded-[14px] border px-3 py-2 text-xs font-semibold ${tone === 'error' ? 'border-[#FF4B4B]/30 bg-[#FF4B4B]/10 text-[#FFB3B3]' : 'border-[#8FFF3C]/30 bg-[#8FFF3C]/10 text-[#D8FFC5]'}`}>{message}</p>; }

function normalizeSport(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function storedIntent(): ReservationIntent | null { if (typeof window === 'undefined') return null; try { const stored = window.sessionStorage.getItem(PENDING_RESERVATION_KEY); return stored ? JSON.parse(stored) as ReservationIntent : null; } catch { return null; } }
function ambientForSport(sport: string) { const key = normalizeSport(sport); return key === 'beachtennis' || key === 'futevolei' ? 'rgba(222,157,75,.15)' : key === 'tenis' ? 'rgba(74,168,123,.16)' : key === 'volei' ? 'rgba(85,132,207,.15)' : 'rgba(143,255,60,.17)'; }
function reservationTime(value: string) { return value ? formatTimeBR(value) : ''; }
function friendlyError(message: string) { const lower = message.toLowerCase(); return lower.includes('invalid') || lower.includes('credencial') ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar agora.'; }
function ArrowLeftIcon() { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="m15 18-6-6 6-6M9 12h12" /></svg>; }
function EyeIcon({ hidden }: { hidden: boolean }) { return <svg aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24">{hidden ? <><path d="m3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 5.1A10.8 10.8 0 0 1 12 5c5 0 8.6 4.3 9.6 7-0.5 1.3-1.5 3-3.1 4.4M6.2 6.2C4.4 7.6 3.2 9.8 2.4 12c1 2.7 4.6 7 9.6 7 1.6 0 3-.4 4.2-1" /></> : <><path d="M2.4 12C3.4 9.3 7 5 12 5s8.6 4.3 9.6 7c-1 2.7-4.6 7-9.6 7s-8.6-4.3-9.6-7Z" /><circle cx="12" cy="12" r="3" /></>}</svg>; }
function SportFallbackIcon() { return <svg aria-hidden="true" className="h-7 w-7 text-[#8FFF3C]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /><path d="M5 12h14M12 5a11 11 0 0 1 0 14M12 5a11 11 0 0 0 0 14" /></svg>; }
