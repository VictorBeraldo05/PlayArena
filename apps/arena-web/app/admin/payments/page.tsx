'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '../../../components/use-auth';
import { apiRequest } from '../../../lib/api';
import { formatCurrencyBRL } from '../../../lib/format';
import { usePageReadyResource } from '../../../providers/page-ready-provider';

type PaymentRow = {
  id: string;
  provider: string;
  payment_method: string;
  provider_payment_id?: string | null;
  amount: string | number;
  currency: 'BRL';
  status: string;
  reservation_id?: string | null;
  arena_name: string;
  created_at: string;
  paid_at?: string | null;
  failure_code?: string | null;
};
type PaymentReport = {
  overview: {
    payments: number;
    paid_amount: string | number;
    paid: number;
    failed: number;
    pending: number;
    pending_stale: number;
    credits: string | number;
  };
  payments: PaymentRow[];
  reconciliation: {
    paid_without_reservation_or_credit: number;
    missing_reservation: number;
    mismatched_reservation_payment: number;
  };
};

export default function AdminPaymentsPage() {
  const router = useRouter();
  const { session, profile, isLoading } = useAuth();
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<PaymentReport | null>(null);
  const [error, setError] = useState('');
  const [reloadVersion, setReloadVersion] = useState(0);
  const [reconcilingId, setReconcilingId] = useState('');
  usePageReadyResource(
    'admin-payments',
    Boolean(report || error || (!isLoading && profile?.role !== 'admin')),
  );

  useEffect(() => {
    if (!isLoading && !session) router.replace('/login');
    else if (!isLoading && profile && profile.role !== 'admin') router.replace('/buscar');
  }, [isLoading, profile, router, session]);

  useEffect(() => {
    if (!session || profile?.role !== 'admin') return;
    let active = true;
    void apiRequest<PaymentReport>(`/admin/payments?days=${days}`, session.access_token, {
      cache: 'no-store',
    })
      .then((data) => {
        if (active) setReport(data);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar os pagamentos.');
      });
    return () => {
      active = false;
    };
  }, [days, profile?.role, reloadVersion, session]);

  async function reconcile(payment: PaymentRow) {
    if (!session || reconcilingId) return;
    setReconcilingId(payment.id);
    setError('');
    try {
      await apiRequest(`/admin/payments/${payment.id}/reconcile`, session.access_token, {
        method: 'POST',
      });
      setReport(null);
      setReloadVersion((version) => version + 1);
    } catch {
      setError('Não foi possível reconciliar essa Order agora.');
    } finally {
      setReconcilingId('');
    }
  }

  if (isLoading || profile?.role !== 'admin')
    return <main className="min-h-[100dvh] bg-[#080D14]" />;
  const issues = report
    ? Object.values(report.reconciliation).reduce((total, value) => total + Number(value), 0) +
      Number(report.overview.pending_stale)
    : 0;
  return (
    <main className="min-h-[100dvh] bg-[#080D14] px-4 pb-12 pt-[max(1.25rem,env(safe-area-inset-top))] text-white sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <Link
              className="text-xs font-extrabold uppercase tracking-[.18em] text-[#8FFF3C]"
              href="/admin/analytics"
            >
              ← Analytics
            </Link>
            <h1 className="mt-3 text-[32px] font-extrabold tracking-[-.06em]">Pagamentos</h1>
            <p className="mt-2 text-sm text-[#9DA7B3]">Operação e reconciliação financeira</p>
          </div>
          <div className="flex gap-2">
            {[7, 30, 90].map((value) => (
              <button
                className={`min-h-10 rounded-xl px-4 text-sm font-bold ${days === value ? 'bg-[#8FFF3C] text-[#080D14]' : 'border border-white/10 bg-[#111923] text-[#C3CDD7]'}`}
                key={value}
                onClick={() => {
                  setReport(null);
                  setError('');
                  setDays(value);
                }}
                type="button"
              >
                {value} dias
              </button>
            ))}
          </div>
        </header>
        {error ? (
          <p className="mt-8 rounded-2xl border border-[#FF4B4B]/25 bg-[#FF4B4B]/10 p-5 text-sm font-semibold text-[#FFB3B3]">
            {error}
          </p>
        ) : null}
        {!report && !error ? (
          <div className="mt-8 grid gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <div className="h-28 animate-pulse rounded-[20px] bg-[#111923]" key={item} />
            ))}
          </div>
        ) : null}
        {report ? (
          <>
            <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Metric label="Pagamentos" value={report.overview.payments} />
              <Metric label="Aprovados" value={report.overview.paid} />
              <Metric
                label="Valor aprovado"
                value={formatCurrencyBRL(report.overview.paid_amount)}
              />
              <Metric label="Créditos gerados" value={formatCurrencyBRL(report.overview.credits)} />
              <Metric alert={issues > 0} label="Divergências" value={issues} />
            </section>
            <section className="mt-7 overflow-hidden rounded-[22px] border border-white/10 bg-[#111923]">
              <div className="flex items-center justify-between border-b border-white/10 p-5">
                <h2 className="text-lg font-extrabold">Movimentações recentes</h2>
                <span className="text-xs text-[#9DA7B3]">Sem dados bancários</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1060px] text-left text-sm">
                  <thead className="text-[10px] uppercase tracking-[.12em] text-[#9DA7B3]">
                    <tr>
                      <th className="px-5 py-3">Data</th>
                      <th className="px-5 py-3">Arena</th>
                      <th className="px-5 py-3">Provider</th>
                      <th className="px-5 py-3">MÃ©todo</th>
                      <th className="px-5 py-3">Order</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Reserva</th>
                      <th className="px-5 py-3 text-right">Valor</th>
                      <th className="px-5 py-3 text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.payments.map((payment) => (
                      <tr className="border-t border-white/[.06]" key={payment.id}>
                        <td className="px-5 py-4 text-[#C3CDD7]">
                          {formatDate(payment.created_at)}
                        </td>
                        <td className="px-5 py-4 font-bold">{payment.arena_name}</td>
                        <td className="px-5 py-4 text-[#C3CDD7]">
                          {payment.provider === 'mercado_pago' ? 'Mercado Pago' : payment.provider}
                        </td>
                        <td className="px-5 py-4 text-[#C3CDD7]">
                          {payment.payment_method === 'pix' ? 'PIX' : payment.payment_method === 'checkout_pro' ? 'Checkout Pro' : payment.payment_method === 'wallet' ? 'Saldo' : 'Sandbox'}
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-[#9DA7B3]">
                          {maskProviderOrder(payment.provider_payment_id)}
                        </td>
                        <td className="px-5 py-4">
                          <Status status={payment.status} />
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-[#9DA7B3]">
                          {payment.reservation_id ? payment.reservation_id.slice(0, 8) : '—'}
                        </td>
                        <td className="px-5 py-4 text-right font-extrabold">
                          {formatCurrencyBRL(payment.amount)}
                        </td>
                        <td className="px-5 py-4 text-right">
                          {payment.provider === 'mercado_pago' && payment.provider_payment_id ? (
                            <button
                              className="min-h-9 rounded-xl border border-[#8FFF3C]/25 px-3 text-xs font-bold text-[#8FFF3C] disabled:opacity-50"
                              disabled={Boolean(reconcilingId)}
                              onClick={() => void reconcile(payment)}
                              type="button"
                            >
                              {reconcilingId === payment.id ? 'Consultando...' : 'Reconciliar'}
                            </button>
                          ) : (
                            <span className="text-[#55616E]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            <section className="mt-7 rounded-[22px] border border-white/10 bg-[#111923] p-5">
              <h2 className="text-lg font-extrabold">Reconciliação</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Reconciliation
                  label="Pago sem reserva ou crédito"
                  value={report.reconciliation.paid_without_reservation_or_credit}
                />
                <Reconciliation
                  label="Reserva ausente"
                  value={report.reconciliation.missing_reservation}
                />
                <Reconciliation
                  label="Vínculo divergente"
                  value={report.reconciliation.mismatched_reservation_payment}
                />
                <Reconciliation label="Pendentes vencidos" value={report.overview.pending_stale} />
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string | number;
  alert?: boolean;
}) {
  return (
    <section
      className={`rounded-[20px] border p-5 ${alert ? 'border-[#FFB45E]/30 bg-[#FFB45E]/[.08]' : 'border-white/10 bg-[#111923]'}`}
    >
      <p className="text-xs font-bold uppercase tracking-[.12em] text-[#9DA7B3]">{label}</p>
      <strong
        className={`mt-3 block text-2xl font-extrabold tracking-[-.05em] ${alert ? 'text-[#FFD29A]' : ''}`}
      >
        {value}
      </strong>
    </section>
  );
}
function Reconciliation({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-[#080D14]/55 p-4">
      <strong className={value ? 'text-[#FFB45E]' : 'text-[#8FFF3C]'}>{value}</strong>
      <p className="mt-2 text-xs text-[#9DA7B3]">{label}</p>
    </div>
  );
}
function Status({ status }: { status: string }) {
  const labels: Record<string, string> = {
    pending: 'Pendente',
    paid: 'Pago',
    failed: 'Falhou',
    expired: 'Expirado',
    cancelled: 'Cancelado',
  };
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-bold ${status === 'paid' ? 'bg-[#8FFF3C]/10 text-[#8FFF3C]' : status === 'pending' ? 'bg-[#FFB45E]/10 text-[#FFD29A]' : 'bg-white/[.06] text-[#C3CDD7]'}`}
    >
      {labels[status] ?? status}
    </span>
  );
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
}

function maskProviderOrder(value?: string | null) {
  if (!value) return '—';
  return value.length <= 8 ? value : `••••${value.slice(-8)}`;
}
