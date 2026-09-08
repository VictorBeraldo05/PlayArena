import Link from 'next/link';

import { AppShell } from '../../../components/app-shell';
import { OwnerGuard } from '../../../components/owner-guard';
import { OwnerNavigation } from '../../../components/owner-navigation';

const sections = [
  { title: 'Dados da arena', description: 'Informações e perfil público', href: '/dashboard/arena', symbol: 'A' },
  { title: 'Campos', description: 'Campos e modalidades', href: '/dashboard/quadras', symbol: 'C' },
  { title: 'Horários', description: 'Funcionamento da arena', href: '/dashboard/horarios', symbol: 'H' },
  { title: 'Preços', description: 'Valores e regras especiais', href: '/dashboard/precos', symbol: 'R$' },
];

export default function MyArenaPage() {
  return <AppShell eyebrow="Configuração" title="Minha arena" subtitle="Configure como sua arena funciona e aparece no PlayArena."><OwnerGuard><section aria-labelledby="configuration-title" className="overflow-hidden rounded-[20px] border border-white/5 bg-[#111923]"><h2 className="border-b border-white/10 px-5 py-4 text-sm font-bold uppercase tracking-[0.16em] text-[#9DA7B3]" id="configuration-title">Configuração</h2><div>{sections.map((section, index) => <Link className={`flex min-h-[74px] items-center gap-4 px-5 py-3 transition hover:bg-white/[0.03] focus-visible:bg-white/[0.03] ${index > 0 ? 'border-t border-white/10' : ''}`} href={section.href} key={section.href}><span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#18212D] text-xs font-extrabold text-[#8FFF3C]">{section.symbol}</span><span className="min-w-0 flex-1"><span className="block font-bold text-white">{section.title}</span><span className="mt-1 block text-sm text-[#9DA7B3]">{section.description}</span></span><span aria-hidden="true" className="text-xl text-[#9DA7B3]">›</span></Link>)}</div></section><OwnerNavigation /></OwnerGuard></AppShell>;
}
