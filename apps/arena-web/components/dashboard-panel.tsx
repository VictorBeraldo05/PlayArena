'use client';

import { useRouter } from 'next/navigation';

import { Arena } from '@playarena/types';

import { useAuth } from './use-auth';

export function DashboardPanel({ arena }: { arena: Arena }) {
  const router = useRouter();
  const { signOut } = useAuth();

  const metrics = [
    { label: 'Reservas hoje', value: '0', note: 'Nenhuma reserva ainda' },
    { label: 'Ocupacao', value: '0%', note: 'Sem quadras configuradas' },
    { label: 'Faturamento', value: 'R$ 0', note: 'Aguardando operacao inicial' },
    {
      label: 'Proximas reservas',
      value: 'Nenhuma reserva ainda',
      note: 'Assim que surgirem, elas aparecerao aqui',
    },
  ];

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 rounded-[18px] border border-white/5 bg-[#111923] p-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.24em] text-[#8FFF3C]">Sua arena</p>
          <h2 className="mt-3 text-3xl font-bold text-white">{arena.name}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#9DA7B3]">
            {arena.address}, {arena.city}/{arena.state}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            className="h-14 rounded-2xl bg-[#8FFF3C] px-6 text-sm font-bold text-[#080D14]"
            type="button"
          >
            Configurar quadras
          </button>
          <button
            className="h-14 rounded-2xl border border-white/10 px-6 text-sm font-semibold text-white"
            onClick={() => {
              void signOut();
              router.replace('/login');
            }}
            type="button"
          >
            Sair
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <article
            key={metric.label}
            className="rounded-[18px] border border-white/5 bg-[#111923] p-5"
          >
            <p className="text-sm text-[#9DA7B3]">{metric.label}</p>
            <strong className="mt-6 block text-2xl text-white">{metric.value}</strong>
            <p className="mt-2 text-sm text-[#8FFF3C]">{metric.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
