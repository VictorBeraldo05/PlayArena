'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { PlayerBottomNav } from '../../../components/player-bottom-nav';
import { useAuth } from '../../../components/use-auth';
import { apiRequest } from '../../../lib/api';
import { formatCurrencyBRL } from '../../../lib/format';
import { usePageReadyResource } from '../../../providers/page-ready-provider';

type WalletTransaction = {
  id: string;
  type: 'refund_credit' | 'booking_debit' | 'admin_adjustment';
  amount: string | number;
  currency: 'BRL';
  reason: string;
  arena_name?: string | null;
  created_at: string;
};
type Wallet = { balance: string | number; currency: 'BRL'; transactions: WalletTransaction[] };

export default function PlayerBalancePage() {
  const router = useRouter();
  const { session, isLoading } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [error, setError] = useState('');
  usePageReadyResource('player-wallet', Boolean(wallet || error || (!isLoading && !session)));

  useEffect(() => {
    if (isLoading) return;
    if (!session) {
      router.replace('/login?returnTo=/player/saldo');
      return;
    }
    let active = true;
    void apiRequest<Wallet>('/player/wallet', session.access_token, { cache: 'no-store' })
      .then((data) => {
        if (active) setWallet(data);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar seu saldo.');
      });
    return () => {
      active = false;
    };
  }, [isLoading, router, session]);

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#080D14] pb-28 text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-[390px] bg-[radial-gradient(circle_at_48%_0%,rgba(143,255,60,.16),transparent_68%)]"
      />
      <div className="relative mx-auto w-full max-w-[640px] px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))] sm:px-5">
        <header className="grid grid-cols-[44px_1fr_44px] items-center">
          <button
            aria-label="Voltar ao perfil"
            className="grid h-11 w-11 place-items-center rounded-xl text-2xl text-[#C3CDD7]"
            onClick={() => router.back()}
            type="button"
          >
            ‹
          </button>
          <h1 className="text-center text-xl font-black tracking-[-.04em]">Saldo PlayArena</h1>
          <span />
        </header>
        {error ? (
          <section className="mt-8 rounded-[22px] border border-[#FF4B4B]/25 bg-[#FF4B4B]/10 p-5 text-sm font-semibold text-[#FFB3B3]">
            {error}
          </section>
        ) : null}
        {!wallet && !error ? <WalletSkeleton /> : null}
        {wallet ? (
          <>
            <section className="relative mt-7 overflow-hidden rounded-[28px] border border-[#8FFF3C]/20 bg-[#111923] p-6 shadow-[0_24px_70px_rgba(0,0,0,.3)]">
              <div
                aria-hidden="true"
                className="absolute -right-14 -top-16 h-44 w-44 rounded-full bg-[#8FFF3C]/10 blur-2xl"
              />
              <div className="relative">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-extrabold uppercase tracking-[.18em] text-[#9DA7B3]">
                    Crédito disponível
                  </p>
                  <WalletIcon />
                </div>
                <strong className="mt-7 block text-[42px] font-black leading-none tracking-[-.065em]">
                  {formatCurrencyBRL(wallet.balance)}
                </strong>
                <p className="mt-3 text-sm text-[#9DA7B3]">Use seu saldo em novas reservas.</p>
                <div className="mt-7 h-px bg-white/[.08]" />
                <p className="mt-4 flex items-center gap-2 text-xs font-semibold text-[#C3CDD7]">
                  <ShieldIcon /> Créditos protegidos no PlayArena
                </p>
              </div>
            </section>
            <section className="mt-8">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[.18em] text-[#8FFF3C]">
                    Movimentações
                  </p>
                  <h2 className="mt-1 text-xl font-black tracking-[-.04em]">Histórico</h2>
                </div>
                <span className="text-xs text-[#7F8A97]">Últimas 100</span>
              </div>
              {wallet.transactions.length ? (
                <div className="mt-4 overflow-hidden rounded-[22px] border border-white/[.08] bg-[#111923]">
                  {wallet.transactions.map((transaction) => (
                    <TransactionRow key={transaction.id} transaction={transaction} />
                  ))}
                </div>
              ) : (
                <div className="mt-4 rounded-[22px] border border-dashed border-white/10 bg-[#111923]/60 p-7 text-center">
                  <p className="font-bold">Nenhuma movimentação ainda.</p>
                  <p className="mt-2 text-sm text-[#9DA7B3]">
                    Seus créditos e usos aparecerão aqui.
                  </p>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
      <PlayerBottomNav />
    </main>
  );
}

function TransactionRow({ transaction }: { transaction: WalletTransaction }) {
  const credit = Number(transaction.amount) > 0;
  const label =
    transaction.type === 'booking_debit'
      ? 'Utilizado em reserva'
      : transaction.type === 'refund_credit'
        ? 'Crédito de reserva'
        : 'Ajuste PlayArena';
  const date = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  })
    .format(new Date(transaction.created_at))
    .replace('.', '');
  return (
    <article className="flex items-center gap-3 border-b border-white/[.07] p-4 last:border-0">
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${credit ? 'bg-[#8FFF3C]/10 text-[#8FFF3C]' : 'bg-white/[.05] text-[#C3CDD7]'}`}
      >
        {credit ? <PlusIcon /> : <ArrowIcon />}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-extrabold">{label}</h3>
        <p className="mt-1 truncate text-xs text-[#9DA7B3]">
          {transaction.arena_name || transaction.reason} · {date}
        </p>
      </div>
      <strong className={`whitespace-nowrap text-sm ${credit ? 'text-[#8FFF3C]' : 'text-white'}`}>
        {credit ? '+' : '-'} {formatCurrencyBRL(Math.abs(Number(transaction.amount)))}
      </strong>
    </article>
  );
}

function WalletSkeleton() {
  return (
    <div className="mt-7 space-y-7">
      <div className="h-[230px] animate-pulse rounded-[28px] bg-[#111923]" />
      <div className="h-[210px] animate-pulse rounded-[22px] bg-[#111923]" />
    </div>
  );
}
function WalletIcon() {
  return (
    <svg
      aria-hidden="true"
      className="text-[#8FFF3C]"
      fill="none"
      height="28"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width="28"
    >
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19a1 1 0 0 1 1 1v13H6.5A2.5 2.5 0 0 1 4 16.5z" />
      <path d="M4 8h15M16 12h4v4h-4a2 2 0 0 1 0-4Z" />
    </svg>
  );
}
function ShieldIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M12 3 5 6v5c0 4.6 2.7 8.1 7 10 4.3-1.9 7-5.4 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="20"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function ArrowIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="20"
    >
      <path d="m7 7 10 10M8 17h9V8" />
    </svg>
  );
}
