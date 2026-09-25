'use client';

import { FormEvent, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { ArenaMedia } from '../../components/arena-media';
import { useAuth } from '../../components/use-auth';
import { ApiRequestError, apiRequest } from '../../lib/api';
import { trackEvent } from '../../lib/analytics';
import {
  formatCurrencyBRL,
  formatReservationDateParts,
  formatReservationTimeRange,
  formatTimeBR,
  todayInSaoPaulo,
} from '../../lib/format';
import { usePageReadyResource } from '../../providers/page-ready-provider';

const PENDING_RESERVATION_KEY = 'playarena_pending_reservation';
const PENDING_CHECKOUT_KEY = 'playarena_pending_checkout';
const monthNames = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

type ReservationIntent = {
  arena: string;
  arenaId?: string;
  logoPath?: string;
  court: string;
  courtId: string;
  sport: string;
  startAt: string;
  endAt: string;
  price: string;
  duration: string;
};
type CheckoutQuote = {
  arena_id: string;
  arena_name: string;
  logo_path?: string;
  court_id: string;
  court_name: string;
  sport_name: string;
  start_at: string;
  end_at: string;
  court_price_total: string | number;
  booking_amount: string | number;
  amount_due_at_venue: string | number;
  currency: 'BRL';
  wallet_balance: string | number;
  wallet_available: boolean;
  wallet_has_balance: boolean;
  use_wallet_balance: boolean;
  wallet_amount: string | number;
  provider_amount: string | number;
  requires_provider: boolean;
  provider_available: boolean;
  checkout_available: boolean;
  payment_provider?: 'sandbox' | 'mercado_pago' | null;
  hold_minutes: number;
};
type CheckoutPayment = CheckoutQuote & {
  payment_id: string;
  provider: 'wallet' | 'sandbox' | string;
  provider_payment_id?: string;
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';
  reservation_id?: string | null;
  checkout_url?: string | null;
  expires_at: string;
};
type CheckoutStage = 'review' | 'processing' | 'failed' | 'success';
type StoredCheckoutAttempt = {
  key: string;
  courtId: string;
  startAt: string;
  useWalletBalance: boolean;
};

function storedIntent(): ReservationIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(
      window.sessionStorage.getItem(PENDING_RESERVATION_KEY) ?? 'null',
    ) as ReservationIntent | null;
  } catch {
    return null;
  }
}

function storedCheckoutAttempt(intent: ReservationIntent): StoredCheckoutAttempt | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(PENDING_CHECKOUT_KEY) ?? 'null') as {
      key?: string;
      courtId?: string;
      startAt?: string;
      useWalletBalance?: boolean;
    } | null;
    if (!stored?.key || stored.courtId !== intent.courtId || stored.startAt !== intent.startAt)
      return null;
    return {
      key: stored.key,
      courtId: stored.courtId,
      startAt: stored.startAt,
      useWalletBalance: Boolean(stored.useWalletBalance),
    };
  } catch {
    return null;
  }
}

function persistCheckoutKey(intent: ReservationIntent, key: string, useWalletBalance: boolean) {
  window.sessionStorage.setItem(
    PENDING_CHECKOUT_KEY,
    JSON.stringify({ key, courtId: intent.courtId, startAt: intent.startAt, useWalletBalance }),
  );
}

function clearCheckoutKey() {
  window.sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
}

function friendlyDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return 'Data a confirmar';
  return value.slice(0, 10) === todayInSaoPaulo()
    ? `Hoje, ${String(day).padStart(2, '0')} de ${monthNames[month - 1]}`
    : `${String(day).padStart(2, '0')} de ${monthNames[month - 1]} de ${year}`;
}

function ReservationPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { session, profile, isLoading, refreshProfile } = useAuth();
  const [intent] = useState<ReservationIntent>(() => {
    const fromSearch = {
      arena: params.get('arena') ?? '',
      arenaId: params.get('arenaId') ?? undefined,
      logoPath: params.get('logoPath') ?? undefined,
      court: params.get('court') ?? '',
      courtId: params.get('courtId') ?? '',
      sport: params.get('sport') ?? '',
      startAt: params.get('startAt') ?? '',
      endAt: params.get('endAt') ?? '',
      price: params.get('price') ?? '',
      duration: params.get('duration') ?? '60',
    };
    return fromSearch.courtId ? fromSearch : (storedIntent() ?? fromSearch);
  });
  const [storedAttempt] = useState<StoredCheckoutAttempt | null>(() =>
    storedCheckoutAttempt(intent),
  );
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [payment, setPayment] = useState<CheckoutPayment | null>(null);
  const [useWalletBalance, setUseWalletBalance] = useState(
    storedAttempt?.useWalletBalance ?? false,
  );
  const [quoteRefreshing, setQuoteRefreshing] = useState(false);
  const [quoteReloadVersion, setQuoteReloadVersion] = useState(0);
  const [checkoutAttemptLocked, setCheckoutAttemptLocked] = useState(Boolean(storedAttempt));
  const [stage, setStage] = useState<CheckoutStage>('review');
  const [error, setError] = useState('');
  const idempotencyKey = useRef<string>(storedAttempt?.key ?? '');
  const submissionLock = useRef(false);
  const validIntent = Boolean(
    intent.arena &&
    intent.court &&
    intent.courtId &&
    intent.sport &&
    intent.startAt &&
    intent.endAt,
  );
  const profileComplete = Boolean(profile?.full_name?.trim() && profile?.phone?.trim());
  const profileError = Boolean(session && !isLoading && !profile);
  const quoteLoading = Boolean(session && profileComplete && !quote && !error);
  usePageReadyResource(
    'checkout-intent',
    validIntent && !isLoading && (!session || Boolean(quote || error)),
  );

  useEffect(() => {
    if (!session || !profileComplete || !validIntent) return;
    let active = true;
    const query = new URLSearchParams({
      court_id: intent.courtId,
      start_at: intent.startAt,
      sport: intent.sport,
      use_wallet_balance: String(useWalletBalance),
    });
    void apiRequest<CheckoutQuote>(
      `/player/checkout/quote?${query.toString()}`,
      session.access_token,
      { cache: 'no-store' },
    )
      .then((data) => {
        if (!active) return;
        setQuote(data);
        setQuoteRefreshing(false);
      })
      .catch((requestError) => {
        if (!active) return;
        setQuoteRefreshing(false);
        const unavailable = requestError instanceof ApiRequestError && requestError.status === 409;
        setError(
          unavailable
            ? 'Esse horário não está mais disponível.'
            : 'Não foi possível carregar os valores desta reserva.',
        );
      });
    return () => {
      active = false;
    };
  }, [
    intent.courtId,
    intent.sport,
    intent.startAt,
    profileComplete,
    quoteReloadVersion,
    session,
    useWalletBalance,
    validIntent,
  ]);

  function savePendingIntent() {
    window.sessionStorage.setItem(PENDING_RESERVATION_KEY, JSON.stringify(intent));
  }
  function completeProfile() {
    savePendingIntent();
    router.push(`/player/perfil?returnTo=${encodeURIComponent('/reservar')}`);
  }

  function changeWalletUsage(checked: boolean) {
    if (!quote || quoteRefreshing || idempotencyKey.current) return;
    setError('');
    setQuoteRefreshing(true);
    setUseWalletBalance(checked);
  }

  async function waitForConfirmation(paymentId: string, accessToken: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const current = await apiRequest<CheckoutPayment>(
        `/player/payments/${paymentId}`,
        accessToken,
        { cache: 'no-store' },
      );
      setPayment(current);
      if (current.status === 'paid' && current.reservation_id) return current;
      if (
        ['failed', 'expired', 'cancelled'].includes(current.status) ||
        (current.status === 'paid' && !current.reservation_id)
      ) {
        throw new ApiRequestError(
          current.status === 'expired'
            ? 'O tempo para pagamento terminou.'
            : 'Não foi possível concluir o pagamento.',
          409,
          current.status,
        );
      }
      await new Promise((resolve) => window.setTimeout(resolve, 900));
    }
    throw new ApiRequestError(
      'A confirmação está demorando mais que o esperado.',
      408,
      'payment_timeout',
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionLock.current || !validIntent) return;
    if (!session) {
      trackEvent('reservation_login_required', {
        arenaId: intent.arenaId,
        courtId: intent.courtId,
        properties: { sport: intent.sport, start_at: intent.startAt },
      });
      savePendingIntent();
      router.push('/login?returnTo=/reservar');
      return;
    }
    if (!profile) {
      setError('Não foi possível carregar seus dados.');
      return;
    }
    if (!profileComplete) {
      completeProfile();
      return;
    }
    if (profile.role !== 'player') {
      setError('Esta conta não pode solicitar pré-reserva.');
      return;
    }
    if (!quote) return;
    if (!quote.checkout_available) {
      setError('O pagamento via PIX ainda não está disponível.');
      return;
    }

    submissionLock.current = true;
    setStage('processing');
    setError('');
    if (!idempotencyKey.current) {
      idempotencyKey.current = `checkout_${crypto.randomUUID()}`;
      persistCheckoutKey(intent, idempotencyKey.current, quote.use_wallet_balance);
      setCheckoutAttemptLocked(true);
    }
    trackEvent('checkout_started', {
      arenaId: quote.arena_id,
      courtId: quote.court_id,
      properties: {
        source: quote.requires_provider
          ? quote.use_wallet_balance && quote.wallet_has_balance
            ? 'wallet_pix'
            : 'pix'
          : 'wallet',
        sport: intent.sport,
        start_at: quote.start_at,
      },
    });
    try {
      const created = await apiRequest<CheckoutPayment>('/player/checkout', session.access_token, {
        method: 'POST',
        body: JSON.stringify({
          court_id: intent.courtId,
          start_at: intent.startAt,
          sport: intent.sport,
          payment_method: 'provider',
          use_wallet_balance: quote.use_wallet_balance,
          quoted_wallet_amount: quote.wallet_amount,
          quoted_provider_amount: quote.provider_amount,
          idempotency_key: idempotencyKey.current,
        }),
      });
      setPayment(created);
      let confirmed = created;
      if (created.status === 'pending' && created.provider === 'sandbox') {
        await apiRequest(
          `/player/payments/${created.payment_id}/sandbox-complete`,
          session.access_token,
          { method: 'POST', body: JSON.stringify({ outcome: 'paid' }) },
        );
        confirmed = await waitForConfirmation(created.payment_id, session.access_token);
      } else if (created.status === 'pending' && created.checkout_url) {
        window.location.assign(created.checkout_url);
        return;
      } else if (created.status === 'pending') {
        confirmed = await waitForConfirmation(created.payment_id, session.access_token);
      }
      if (confirmed.status !== 'paid' || !confirmed.reservation_id)
        throw new Error('payment_not_confirmed');
      setPayment(confirmed);
      window.sessionStorage.removeItem(PENDING_RESERVATION_KEY);
      clearCheckoutKey();
      setStage('success');
    } catch (requestError) {
      const apiError = requestError instanceof ApiRequestError ? requestError : null;
      if (
        !['payment_creation_pending', 'payment_reference_pending', 'payment_timeout'].includes(
          apiError?.code ?? '',
        )
      ) {
        idempotencyKey.current = '';
        clearCheckoutKey();
        setCheckoutAttemptLocked(false);
      }
      if (apiError?.code === 'payment_plan_changed') {
        setQuote(null);
        setQuoteReloadVersion((version) => version + 1);
      }
      setError(
        apiError?.code === 'slot_unavailable'
          ? 'Esse horário não está mais disponível.'
          : apiError?.message || 'Não foi possível concluir o pagamento.',
      );
      setStage('failed');
    } finally {
      submissionLock.current = false;
    }
  }

  if (!validIntent) return <Unavailable onBack={() => router.push('/buscar')} />;
  if (stage === 'processing') return <Processing />;
  if (stage === 'success' && payment) return <Success intent={intent} payment={payment} />;

  return (
    <main className="min-h-[100dvh] bg-[#080D14] pb-32 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_50%_-12%,rgba(143,255,60,.14),transparent_64%)]"
      />
      <div className="relative mx-auto max-w-[540px] px-4 pb-6 pt-[max(.75rem,env(safe-area-inset-top))] sm:px-5">
        <header className="grid min-h-12 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2">
          <button
            aria-label="Voltar"
            className="grid h-9 w-9 place-items-center rounded-xl text-2xl text-[#C3CDD7]"
            onClick={() => router.back()}
            type="button"
          >
            ‹
          </button>
          <div className="min-w-0 text-center">
            <p className="text-[9px] font-extrabold uppercase tracking-[.17em] text-[#8FFF3C]">
              Checkout seguro
            </p>
            <h1 className="mt-0.5 whitespace-nowrap text-[17px] font-black tracking-[-.04em]">
              Finalizar reserva
            </h1>
          </div>
          <WalletBalance balance={quote?.wallet_balance} />
        </header>
        <ArenaSummary intent={intent} quote={quote} />
        <form className="mt-3 space-y-3" onSubmit={(event) => void submit(event)}>
          {isLoading || quoteLoading ? (
            <CheckoutSkeleton />
          ) : !session ? (
            <LoginNotice />
          ) : profileError ? (
            <LoadError onRetry={() => void refreshProfile()} />
          ) : !profileComplete ? (
            <ProfileNotice onComplete={completeProfile} />
          ) : quote ? (
            <>
              <FeeExplanation amount={quote.booking_amount} />
              <Values quote={quote} />
              <PaymentChoice
                disabled={quoteRefreshing || checkoutAttemptLocked}
                onChange={changeWalletUsage}
                quote={quote}
              />
              {quoteRefreshing ? (
                <p aria-live="polite" className="text-center text-xs font-semibold text-[#9DA7B3]">
                  Atualizando valores...
                </p>
              ) : null}
            </>
          ) : null}
          {error ? (
            <ErrorNotice
              message={error}
              onChooseAnother={() => router.push('/buscar/disponibilidade')}
            />
          ) : null}
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/[.08] bg-[#0B1119]/95 px-4 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur-xl">
            <div className="mx-auto max-w-[540px]">
              {stage === 'failed' ? (
                <button
                  className="min-h-14 w-full rounded-2xl bg-[#8FFF3C] px-5 font-black text-[#080D14]"
                  onClick={() => {
                    setStage('review');
                    setError('');
                  }}
                  type="button"
                >
                  Tentar novamente
                </button>
              ) : !session ? (
                <button
                  className="min-h-14 w-full rounded-2xl bg-[#8FFF3C] px-5 font-black text-[#080D14]"
                  type="submit"
                >
                  Entrar para continuar
                </button>
              ) : !profileComplete ? (
                <button
                  className="min-h-14 w-full rounded-2xl bg-[#8FFF3C] px-5 font-black text-[#080D14]"
                  onClick={completeProfile}
                  type="button"
                >
                  Completar perfil
                </button>
              ) : (
                <button
                  className="min-h-14 w-full rounded-2xl bg-[#8FFF3C] px-5 font-black text-[#080D14] disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={
                    !quote ||
                    quoteLoading ||
                    quoteRefreshing ||
                    Boolean(error) ||
                    !quote.checkout_available
                  }
                  type="submit"
                >
                  {checkoutCtaLabel(quote, quoteRefreshing)}
                </button>
              )}
              <p className="mt-1.5 text-center text-[10px] font-semibold text-[#7F8A97]">
                Pagamento protegido pelo PlayArena
              </p>
            </div>
          </div>
        </form>
      </div>
    </main>
  );
}

function checkoutCtaLabel(quote: CheckoutQuote | null, refreshing: boolean) {
  if (refreshing) return 'Atualizando valores...';
  if (!quote) return 'Carregando valores...';
  return quote.requires_provider
    ? `Pagar ${formatCurrencyBRL(quote.provider_amount)} via PIX →`
    : `Usar ${formatCurrencyBRL(quote.wallet_amount)} do saldo →`;
}

function WalletBalance({ balance }: { balance?: string | number }) {
  return (
    <div className="flex min-w-[86px] items-center justify-end gap-1.5 rounded-xl border border-white/[.08] bg-[#111923]/90 px-2.5 py-2">
      <WalletIcon />
      <div className="min-w-0 text-right leading-none">
        <span className="block text-[8px] font-bold uppercase tracking-[.08em] text-[#7F8A97]">
          Saldo PlayArena
        </span>
        <b className="mt-1 block whitespace-nowrap text-[11px]">
          {balance === undefined ? '—' : formatCurrencyBRL(balance)}
        </b>
      </div>
    </div>
  );
}

function ArenaSummary({
  intent,
  quote,
}: {
  intent: ReservationIntent;
  quote: CheckoutQuote | null;
}) {
  const arena = quote?.arena_name ?? intent.arena;
  const court = quote?.court_name ?? intent.court;
  const sport = quote?.sport_name ?? intent.sport;
  const start = quote?.start_at ?? intent.startAt;
  const end = quote?.end_at ?? intent.endAt;
  return (
    <section className="mt-3 overflow-hidden rounded-[20px] border border-white/[.08] bg-[#111923]">
      <div className="grid grid-cols-[76px_1fr]">
        <ArenaMedia
          arena={{ name: arena, logo_path: quote?.logo_path ?? intent.logoPath }}
          className="min-h-[112px]"
          critical
          prefer="logo"
          sport={sport}
          variant="ticket"
        />
        <div className="flex min-w-0 flex-col justify-center px-3.5 py-3">
          <h2 className="truncate text-base font-black">{arena}</h2>
          <p className="mt-0.5 truncate text-xs text-[#9DA7B3]">
            {court} · {sport}
          </p>
          <p className="mt-3 text-xs font-bold">{friendlyDate(start)}</p>
          <p className="mt-0.5 text-xs text-[#C3CDD7]">
            {formatReservationTimeRange(start, end)}
          </p>
        </div>
      </div>
    </section>
  );
}

function FeeExplanation({ amount }: { amount: string | number }) {
  return (
    <section className="flex items-start gap-3 rounded-[18px] border border-[#8FFF3C]/20 bg-[#8FFF3C]/[.055] p-3.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#8FFF3C]/10 text-[#8FFF3C]">
        <ShieldIcon />
      </span>
      <div className="min-w-0">
        <h2 className="text-sm font-extrabold">
          Você paga {formatCurrencyBRL(amount)} para solicitar a reserva
        </h2>
        <p className="mt-1 text-[11px] leading-[1.45] text-[#9DA7B3]">
          Se confirmada, esse valor é descontado do pagamento na arena. Se a arena recusar, os{' '}
          {formatCurrencyBRL(amount)} voltam para seu Saldo PlayArena.
        </p>
      </div>
    </section>
  );
}

function Values({ quote }: { quote: CheckoutQuote }) {
  return (
    <section className="rounded-[18px] border border-white/[.08] bg-[#111923] px-4 py-3.5">
      <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#9DA7B3]">
        Valores
      </p>
      <div className="mt-2.5 space-y-2 text-xs">
        <ValueRow label="Valor do campo" value={formatCurrencyBRL(quote.court_price_total)} />
        <ValueRow accent label="Pago agora" value={formatCurrencyBRL(quote.booking_amount)} />
        <div className="h-px bg-white/[.08]" />
        <ValueRow
          strong
          label="Pagar na arena"
          value={formatCurrencyBRL(quote.amount_due_at_venue)}
        />
      </div>
    </section>
  );
}
function ValueRow({
  label,
  value,
  accent = false,
  strong = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
  strong?: boolean;
}) {
  return (
    <p className="flex items-center justify-between gap-4">
      <span className={strong ? 'font-bold text-white' : 'text-[#9DA7B3]'}>{label}</span>
      <b className={accent ? 'text-[#8FFF3C]' : strong ? 'text-sm text-white' : 'text-white'}>
        {value}
      </b>
    </p>
  );
}

function PaymentChoice({
  quote,
  onChange,
  disabled,
}: {
  quote: CheckoutQuote;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  const walletEnabled = quote.use_wallet_balance && quote.wallet_has_balance;
  const plan = !walletEnabled
    ? `${formatCurrencyBRL(quote.wallet_amount)} do saldo + ${formatCurrencyBRL(quote.provider_amount)} via PIX`
    : quote.requires_provider
      ? `${formatCurrencyBRL(quote.wallet_amount)} do saldo + ${formatCurrencyBRL(quote.provider_amount)} via PIX`
      : `${formatCurrencyBRL(quote.wallet_amount)} do Saldo PlayArena`;
  return (
    <section className="rounded-[18px] border border-white/[.08] bg-[#111923] p-4">
      <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[#9DA7B3]">
        Forma de pagamento
      </p>
      <div className="mt-2.5 flex items-center gap-3 rounded-2xl bg-[#18212D] px-3.5 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#8FFF3C]/10 text-[#8FFF3C]">
          <PixIcon />
        </span>
        <div className="min-w-0 flex-1">
          <b className="block text-sm">PIX</b>
          <span className="mt-0.5 block text-[11px] text-[#9DA7B3]">
            Pagamento seguro via Mercado Pago
          </span>
        </div>
        <b className="whitespace-nowrap text-sm">{formatCurrencyBRL(quote.provider_amount)}</b>
      </div>
      <label
        className={`mt-2.5 flex items-center gap-3 rounded-2xl border px-3.5 py-3 ${
          quote.wallet_has_balance
            ? 'cursor-pointer border-white/[.08] bg-[#0D151F]'
            : 'cursor-not-allowed border-white/[.05] bg-[#0D151F]/60'
        }`}
      >
        <span className="min-w-0 flex-1">
          <b className="block text-sm">Usar meu Saldo PlayArena</b>
          <small className="mt-0.5 block text-[11px] text-[#9DA7B3]">
            {quote.wallet_has_balance
              ? `Saldo disponível: ${formatCurrencyBRL(quote.wallet_balance)}`
              : 'Você ainda não possui saldo.'}
          </small>
        </span>
        <input
          aria-label="Usar Saldo PlayArena"
          checked={walletEnabled}
          className="peer sr-only"
          disabled={disabled || !quote.wallet_has_balance}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span className="relative h-6 w-11 shrink-0 rounded-full bg-[#27313D] transition-colors after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-[#9DA7B3] after:transition-transform peer-checked:bg-[#8FFF3C] peer-checked:after:translate-x-5 peer-checked:after:bg-[#080D14] peer-disabled:opacity-45" />
      </label>
      <p className="mt-2.5 rounded-xl border border-white/[.06] bg-white/[.025] px-3 py-2 text-center text-[11px] font-bold text-[#C3CDD7]">
        {plan}
      </p>
    </section>
  );
}

function Processing() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#080D14] px-6 text-center text-white">
      <section>
        <div className="relative mx-auto grid h-24 w-24 place-items-center">
          <i className="absolute inset-0 animate-ping rounded-full border border-[#8FFF3C]/25" />
          <span className="grid h-16 w-16 place-items-center rounded-full bg-[#8FFF3C] text-[#080D14]">
            <LockIcon />
          </span>
        </div>
        <h1 className="mt-7 text-2xl font-black tracking-[-.04em]">Confirmando seu pagamento...</h1>
        <p className="mt-3 text-sm text-[#9DA7B3]">Não feche ou atualize esta tela.</p>
      </section>
    </main>
  );
}
function Unavailable({ onBack }: { onBack: () => void }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[#080D14] px-5 text-white">
      <section className="w-full max-w-md rounded-[22px] border border-white/10 bg-[#111923] p-6 text-center">
        <h1 className="text-2xl font-black">Reserva indisponível</h1>
        <p className="mt-3 text-sm text-[#9DA7B3]">Escolha um horário novamente para continuar.</p>
        <button
          className="mt-6 min-h-14 w-full rounded-2xl bg-[#8FFF3C] font-black text-[#080D14]"
          onClick={onBack}
          type="button"
        >
          Buscar arenas
        </button>
      </section>
    </main>
  );
}
function LoginNotice() {
  return (
    <p className="rounded-[20px] border border-white/[.08] bg-[#111923] p-5 text-sm font-semibold text-[#C3CDD7]">
      Entre na sua conta para conferir os valores e continuar.
    </p>
  );
}
function ProfileNotice({ onComplete }: { onComplete: () => void }) {
  return (
    <section className="rounded-[20px] border border-[#8FFF3C]/20 bg-[#111923] p-5">
      <h2 className="text-lg font-black">Complete seus dados para continuar.</h2>
      <button className="mt-4 font-bold text-[#8FFF3C]" onClick={onComplete} type="button">
        Completar perfil
      </button>
    </section>
  );
}
function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="rounded-[20px] border border-[#FF4B4B]/25 bg-[#111923] p-5">
      <p className="font-bold text-[#FFB3B3]">Não foi possível carregar seus dados.</p>
      <button className="mt-3 text-sm font-bold text-[#8FFF3C]" onClick={onRetry} type="button">
        Tentar novamente
      </button>
    </section>
  );
}
function ErrorNotice({
  message,
  onChooseAnother,
}: {
  message: string;
  onChooseAnother: () => void;
}) {
  return (
    <section
      aria-live="polite"
      className="rounded-[18px] border border-[#FF4B4B]/30 bg-[#FF4B4B]/10 p-4"
    >
      <p className="text-sm font-semibold text-[#FFB3B3]">{message}</p>
      {message.includes('horário') ? (
        <button
          className="mt-3 text-sm font-bold text-[#8FFF3C]"
          onClick={onChooseAnother}
          type="button"
        >
          Escolher outro horário
        </button>
      ) : null}
    </section>
  );
}
function CheckoutSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-40 animate-pulse rounded-[22px] bg-[#111923]" />
      <div className="h-32 animate-pulse rounded-[22px] bg-[#111923]" />
    </div>
  );
}

function Success({ intent, payment }: { intent: ReservationIntent; payment: CheckoutPayment }) {
  const router = useRouter();
  const date = ticketDate(payment.start_at);
  return (
    <main
      className="reservation-success relative min-h-[100dvh] overflow-hidden bg-[#080D14] text-white"
      style={
        {
          '--success-ambient': ambientForSport(payment.sport_name || intent.sport),
        } as CSSProperties
      }
    >
      <div aria-hidden="true" className="reservation-success-bg fixed inset-0" />
      <div aria-hidden="true" className="reservation-success-field fixed inset-x-0 bottom-0" />
      <div className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col items-center px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] text-center">
        <SuccessOrb />
        <p className="mt-5 text-xs font-extrabold uppercase tracking-[.16em] text-[#8FFF3C]">
          Pagamento realizado
        </p>
        <h1 className="mt-2 text-[28px] font-extrabold leading-none tracking-[-.06em]">
          Pré-reserva enviada
        </h1>
        <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-[#AAB7C5]">
          <span className="success-status-dot" />
          Aguardando a arena
        </p>
        <EmailConfirmationNotice />
        <ReservationTicket date={date} intent={intent} payment={payment} />
        <StatusTrack />
        <div className="mt-auto w-full pt-6">
          <button
            className="success-cta min-h-[58px] w-full rounded-[29px] bg-[#8FFF3C] px-5 font-bold text-[#080D14]"
            onClick={() => router.push('/player/reservas')}
            type="button"
          >
            Acompanhar reserva
          </button>
          <button
            className="mt-3 min-h-10 text-sm font-bold text-[#C3CDD7]"
            onClick={() =>
              router.push(`/buscar?${new URLSearchParams({ sport: intent.sport }).toString()}`)
            }
            type="button"
          >
            Buscar outro horário
          </button>
        </div>
      </div>
    </main>
  );
}

function SuccessOrb() {
  return (
    <div className="success-orb relative mt-3 grid h-[84px] w-[84px] place-items-center rounded-full">
      <CheckIcon />
    </div>
  );
}
function EmailConfirmationNotice() {
  return (
    <aside className="mt-4 flex w-full items-start gap-3 rounded-[18px] border border-white/[.08] bg-[#111923]/72 p-3.5 text-left backdrop-blur-md">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[#8FFF3C]/20 bg-[#8FFF3C]/[.08] text-[#8FFF3C]">
        <MailIcon />
      </span>
      <div>
        <p className="text-sm font-extrabold text-white">Fique de olho no seu e-mail</p>
        <p className="mt-1 text-xs leading-[1.45] text-[#9DA7B3]">
          Assim que a arena confirmar sua reserva, enviaremos a confirmação para o e-mail da sua
          conta.
        </p>
      </div>
    </aside>
  );
}
function ReservationTicket({
  intent,
  payment,
  date,
}: {
  intent: ReservationIntent;
  payment: CheckoutPayment;
  date: { main: string; sub: string };
}) {
  return (
    <section className="mt-6 w-full overflow-hidden rounded-[24px] border border-white/[.08] bg-[#111923]/88 text-left backdrop-blur-md">
      <div className="grid grid-cols-[100px_1fr]">
        <ArenaMedia
          arena={{ name: payment.arena_name, logo_path: payment.logo_path ?? intent.logoPath }}
          className="min-h-[190px]"
          prefer="logo"
          priority
          sport={payment.sport_name}
          variant="ticket"
        />
        <div className="min-w-0 p-4">
          <h2 className="truncate text-lg font-extrabold">{payment.arena_name}</h2>
          <p className="mt-1 truncate text-sm text-[#AAB7C5]">
            {payment.court_name} · {payment.sport_name}
          </p>
          <p className="mt-4 text-sm font-bold">
            {date.main} · {formatTimeBR(payment.start_at)}
          </p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[.1em] text-[#9DA7B3]">
            {date.sub}
          </p>
          <div className="mt-4 space-y-1.5 border-t border-white/[.08] pt-3 text-xs">
            <ValueRow label="Total" value={formatCurrencyBRL(payment.court_price_total)} />
            <ValueRow accent label="Pago" value={formatCurrencyBRL(payment.booking_amount)} />
            <ValueRow
              strong
              label="Na arena"
              value={formatCurrencyBRL(payment.amount_due_at_venue)}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
function StatusTrack() {
  return (
    <section className="mt-5 w-full">
      <div className="mx-auto flex max-w-[250px] items-center">
        <span className="success-track-node success-track-active">
          <CheckIcon />
        </span>
        <span className="h-px flex-1 bg-white/15" />
        <span className="success-track-node" />
      </div>
      <div className="mx-auto mt-2 flex max-w-[286px] justify-between text-[10px] font-bold uppercase tracking-[.12em] text-[#AAB7C5]">
        <span className="text-[#8FFF3C]">Solicitada</span>
        <span>Confirmada</span>
      </div>
    </section>
  );
}
function ticketDate(value: string) {
  const { day, month, weekday } = formatReservationDateParts(value);
  return { main: `${day} ${month}`, sub: weekday };
}
function ambientForSport(sport: string) {
  const key = sport
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return key === 'beachtennis' || key === 'futevolei'
    ? 'rgba(222,157,75,.2)'
    : key === 'tenis'
      ? 'rgba(74,168,123,.2)'
      : key === 'volei'
        ? 'rgba(85,132,207,.18)'
        : 'rgba(143,255,60,.2)';
}
function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="h-8 w-8"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.6"
      viewBox="0 0 24 24"
    >
      <path d="m6 12.5 4 4 8-9" />
    </svg>
  );
}
function MailIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="18"
    >
      <rect height="14" rx="2.5" width="18" x="3" y="5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}
function PixIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
      <path
        d="m8.6 4.9 2.2-2.2a1.7 1.7 0 0 1 2.4 0l2.2 2.2a3.4 3.4 0 0 0 2.4 1h.5l3 3a1.7 1.7 0 0 1 0 2.4L18.6 14h-.8a3.4 3.4 0 0 0-2.4 1l-2.2 2.2a1.7 1.7 0 0 1-2.4 0L8.6 15a3.4 3.4 0 0 0-2.4-1h-.8l-2.7-2.7a1.7 1.7 0 0 1 0-2.4l3-3h.5a3.4 3.4 0 0 0 2.4-1Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <path d="m7.2 12 3.2-3.2a2.3 2.3 0 0 1 3.2 0l3.2 3.2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M12 3 5 6v5c0 4.6 2.8 8.1 7 10 4.2-1.9 7-5.4 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function WalletIcon() {
  return (
    <svg
      aria-hidden="true"
      className="text-[#8FFF3C]"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19a1 1 0 0 1 1 1v13H6.5A2.5 2.5 0 0 1 4 16.5z" />
      <path d="M4 8h15M16 12h4v4h-4a2 2 0 0 1 0-4Z" />
    </svg>
  );
}
function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="26"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="26"
    >
      <rect height="11" rx="2" width="14" x="5" y="10" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="min-h-[100dvh] bg-[#080D14]" />}>
      <ReservationPage />
    </Suspense>
  );
}
