'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '../../../components/use-auth';
import { apiRequest } from '../../../lib/api';
import { usePageReadyResource } from '../../../providers/page-ready-provider';

const PENDING_RESERVATION_KEY = 'playarena_pending_reservation';
const PENDING_CHECKOUT_KEY = 'playarena_pending_checkout';
const MAX_POLL_ATTEMPTS = 16;
const POLL_INTERVAL_MS = 1250;

type PaymentStatus = {
  payment_id: string;
  status: 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled';
  reservation_id?: string | null;
  failure_code?: string | null;
};

type ReturnStage = 'loading' | 'processing' | 'success' | 'protected' | 'failed' | 'incomplete';

export default function PaymentReturnPage() {
  return (
    <Suspense fallback={<ReturnShell stage="loading" />}>
      <PaymentReturnContent />
    </Suspense>
  );
}

function PaymentReturnContent() {
  const router = useRouter();
  const params = useSearchParams();
  const { session, isLoading } = useAuth();
  const paymentId = params.get('payment_id') ?? '';
  const [stage, setStage] = useState<ReturnStage>('loading');
  const [message, setMessage] = useState('Aguardando a confirmação segura do Mercado Pago.');
  const visibleStage = paymentId ? stage : 'incomplete';
  const visibleMessage = paymentId
    ? message
    : 'Não encontramos a referência segura desse pagamento.';
  usePageReadyResource(
    'payment-return',
    visibleStage !== 'loading' || (!isLoading && (!session || !paymentId)),
  );

  useEffect(() => {
    if (isLoading) return;
    if (!session) {
      const returnTo = `/pagamento/retorno?payment_id=${encodeURIComponent(paymentId)}`;
      router.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    if (!paymentId) return;

    let active = true;
    let timer: number | undefined;
    const accessToken = session.access_token;
    async function poll(attempt: number) {
      try {
        const payment = await apiRequest<PaymentStatus>(
          `/player/payments/${encodeURIComponent(paymentId)}`,
          accessToken,
          { cache: 'no-store' },
        );
        if (!active) return;
        if (payment.status === 'paid' && payment.reservation_id) {
          clearPendingCheckout(true);
          setStage('success');
          return;
        }
        if (payment.status === 'paid') {
          clearPendingCheckout(true);
          setStage('protected');
          setMessage(
            'O horário não pôde ser reservado e o valor foi protegido no seu Saldo PlayArena.',
          );
          return;
        }
        if (payment.status === 'failed') {
          clearPendingCheckout(false);
          setStage('failed');
          return;
        }
        if (payment.status === 'expired' || payment.status === 'cancelled') {
          clearPendingCheckout(false);
          setStage('incomplete');
          setMessage('Nenhuma pré-reserva foi criada. Você pode iniciar uma nova tentativa.');
          return;
        }
        setStage('processing');
        if (attempt + 1 < MAX_POLL_ATTEMPTS) {
          timer = window.setTimeout(() => void poll(attempt + 1), POLL_INTERVAL_MS);
        } else {
          setMessage(
            'O pagamento ainda está em processamento. Atualizaremos assim que o webhook chegar.',
          );
        }
      } catch {
        if (!active) return;
        setStage('incomplete');
        setMessage('Não foi possível consultar o pagamento com segurança agora.');
      }
    }
    void poll(0);
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [isLoading, paymentId, router, session]);

  return (
    <ReturnShell
      onPrimary={() =>
        visibleStage === 'success'
          ? router.push('/player/reservas')
          : visibleStage === 'protected'
            ? router.push('/player/saldo')
            : router.push('/reservar')
      }
      onSecondary={() => router.push('/buscar')}
      stage={visibleStage}
      message={visibleMessage}
    />
  );
}

function clearPendingCheckout(clearIntent: boolean) {
  window.sessionStorage.removeItem(PENDING_CHECKOUT_KEY);
  if (clearIntent) window.sessionStorage.removeItem(PENDING_RESERVATION_KEY);
}

function ReturnShell({
  stage,
  message,
  onPrimary,
  onSecondary,
}: {
  stage: ReturnStage;
  message?: string;
  onPrimary?: () => void;
  onSecondary?: () => void;
}) {
  const content = returnContent(stage, message);
  return (
    <main className="relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[#080D14] px-5 py-[max(1.5rem,env(safe-area-inset-top))] text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(circle_at_50%_5%,rgba(143,255,60,.15),transparent_65%)]"
      />
      <section className="relative w-full max-w-[430px] text-center">
        <StatusOrb stage={stage} />
        <p className="mt-7 text-[10px] font-extrabold uppercase tracking-[.19em] text-[#8FFF3C]">
          Checkout Mercado Pago
        </p>
        <h1 className="mt-3 text-[30px] font-black leading-[1.02] tracking-[-.055em]">
          {content.title}
        </h1>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-6 text-[#9DA7B3]">{content.body}</p>
        {content.note ? (
          <div className="mt-7 rounded-[20px] border border-white/[.08] bg-[#111923]/85 p-4 text-left backdrop-blur-md">
            <p className="text-xs font-semibold leading-5 text-[#C3CDD7]">{content.note}</p>
          </div>
        ) : null}
        {onPrimary && stage !== 'loading' && stage !== 'processing' ? (
          <button
            className="mt-8 min-h-14 w-full rounded-2xl bg-[#8FFF3C] px-5 font-black text-[#080D14]"
            onClick={onPrimary}
            type="button"
          >
            {content.primary}
          </button>
        ) : null}
        {onSecondary && stage !== 'loading' ? (
          <button
            className="mt-3 min-h-11 px-4 text-sm font-bold text-[#C3CDD7]"
            onClick={onSecondary}
            type="button"
          >
            Voltar ao PlayArena
          </button>
        ) : null}
      </section>
    </main>
  );
}

function returnContent(stage: ReturnStage, message?: string) {
  if (stage === 'success')
    return {
      title: 'Pagamento confirmado',
      body: 'Pré-reserva enviada à arena',
      note: 'Você receberá a confirmação por e-mail.',
      primary: 'Acompanhar reserva',
    };
  if (stage === 'protected')
    return {
      title: 'Pagamento protegido',
      body: message,
      note: 'Nenhum valor ficará sem vínculo ou desaparecerá do seu histórico.',
      primary: 'Ver Saldo PlayArena',
    };
  if (stage === 'failed')
    return {
      title: 'Pagamento falhou',
      body: 'Não foi possível concluir o pagamento.',
      note: 'Nenhuma pré-reserva foi criada e o horário será liberado.',
      primary: 'Tentar novamente',
    };
  if (stage === 'incomplete')
    return {
      title: 'Pagamento não concluído',
      body: message,
      note: 'O PlayArena nunca confirma pagamentos usando parâmetros da URL de retorno.',
      primary: 'Tentar novamente',
    };
  return {
    title: stage === 'loading' ? 'Consultando pagamento' : 'Pagamento em processamento',
    body: message || 'Validando o estado confirmado pelo provider.',
    note: 'Você pode aguardar nesta tela. A consulta termina automaticamente em alguns segundos.',
    primary: '',
  };
}

function StatusOrb({ stage }: { stage: ReturnStage }) {
  const waiting = stage === 'loading' || stage === 'processing';
  const success = stage === 'success' || stage === 'protected';
  return (
    <div
      className={`relative mx-auto grid h-24 w-24 place-items-center rounded-full border ${success ? 'border-[#8FFF3C]/35 bg-[#8FFF3C]/10 text-[#8FFF3C]' : waiting ? 'border-[#8FFF3C]/25 bg-[#111923] text-[#8FFF3C]' : 'border-[#FFB45E]/30 bg-[#FFB45E]/10 text-[#FFD29A]'}`}
    >
      {waiting ? (
        <span className="h-9 w-9 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : null}
      {success ? <CheckIcon /> : null}
      {!waiting && !success ? <AlertIcon /> : null}
      {waiting ? (
        <i className="absolute inset-0 animate-ping rounded-full border border-[#8FFF3C]/20" />
      ) : null}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="40"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.5"
      viewBox="0 0 24 24"
      width="40"
    >
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="38"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="38"
    >
      <path d="M12 8v5M12 17h.01" />
      <path d="M10.3 4.4 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}
