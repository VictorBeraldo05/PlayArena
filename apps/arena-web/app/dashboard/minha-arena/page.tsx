'use client';
/* eslint-disable @next/next/no-img-element -- Arena logos use dynamic Supabase public URLs. */

import Link from 'next/link';
import { useState } from 'react';
import { OwnerGuard } from '../../../components/owner-guard';
import { OwnerNavigation } from '../../../components/owner-navigation';
import { useAuth } from '../../../components/use-auth';
import { getArenaLogoUrl } from '../../../lib/arena-logo';

type IconName = 'arena' | 'courts' | 'hours' | 'prices';

const sections: Array<{ title: string; description: string; href: string; icon: IconName }> = [
  { title: 'Dados da arena', description: 'Perfil e informações', href: '/dashboard/arena', icon: 'arena' },
  { title: 'Campos', description: 'Campos e modalidades', href: '/dashboard/quadras', icon: 'courts' },
  { title: 'Horários', description: 'Dias e horários', href: '/dashboard/horarios', icon: 'hours' },
  { title: 'Preços', description: 'Valores e regras', href: '/dashboard/precos', icon: 'prices' },
];

export default function MyArenaPage() {
  const { ownedArenas } = useAuth();
  const arena = ownedArenas[0];
  return <main className="min-h-screen px-4 pb-28 pt-[max(1.5rem,env(safe-area-inset-top))] md:px-8 md:pt-8"><section className="mx-auto w-full max-w-md"><OwnerGuard><header className="mb-6"><p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-[#8FFF3C]">Configuração</p><h1 className="mt-2 text-[30px] font-bold leading-none tracking-[-0.035em] text-white">Minha arena</h1><p className="mt-3 text-sm text-[#9DA7B3]">Gerencie campos, horários e preços.</p></header>{arena && <ArenaIdentity city={arena.city} logoPath={arena.logo_path} name={arena.name} updatedAt={arena.updated_at}/>}<section aria-label="Opções de configuração" className="relative mt-5 overflow-hidden rounded-[20px] border border-white/[0.06] bg-[linear-gradient(135deg,rgba(21,31,43,.98),rgba(17,25,35,.96))] shadow-[0_18px_42px_rgba(0,0,0,.18)]"><span aria-hidden="true" className="absolute left-5 top-0 h-px w-20 bg-[#8FFF3C]/70 shadow-[0_0_14px_rgba(143,255,60,.55)]"/><div className="relative px-5">{sections.map((section, index) => <Link className={`group flex min-h-[76px] items-center gap-3.5 py-3 transition duration-200 hover:bg-white/[0.025] focus-visible:bg-white/[0.025] active:scale-[0.99] ${index > 0 ? 'border-t border-white/[0.07]' : ''}`} href={section.href} key={section.href}><span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#8FFF3C]/[0.08] bg-[#8FFF3C]/[0.06] text-[#8FFF3C]"><SectionIcon name={section.icon}/></span><span className="min-w-0 flex-1"><span className="block text-[15px] font-bold text-white">{section.title}</span><span className="mt-1 block text-[13px] text-[#9DA7B3]">{section.description}</span></span><ChevronRight/></Link>)}</div></section><OwnerNavigation /></OwnerGuard></section></main>;
}

function ArenaIdentity({ name, city, logoPath, updatedAt }: { name: string; city: string; logoPath: string | null; updatedAt: string }) { const [failed, setFailed] = useState(false); const logoUrl = failed ? null : getArenaLogoUrl(logoPath, updatedAt); return <div className="flex min-h-12 items-center gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-white/10 bg-[#18212D] text-sm font-extrabold text-[#8FFF3C]">{logoUrl ? <img alt={`Logo de ${name}`} className="h-full w-full object-contain p-1.5" onError={() => setFailed(true)} src={logoUrl}/> : name.slice(0, 1).toUpperCase()}</span><span><b className="block text-sm text-[#EAF0F5]">{name}</b><span className="mt-0.5 block text-xs text-[#9DA7B3]">{city}</span></span></div>; }
function ChevronRight() { return <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-[#9DA7B3] transition duration-200 group-hover:translate-x-0.5 group-hover:text-[#8FFF3C]" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>; }
function SectionIcon({ name }: { name: IconName }) { const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.75 }; if (name === 'arena') return <svg className="h-5 w-5" viewBox="0 0 24 24" {...common}><path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-5h6v5M8 10h.01M12 10h.01M16 10h.01"/></svg>; if (name === 'courts') return <svg className="h-5 w-5" viewBox="0 0 24 24" {...common}><rect height="16" rx="2" width="18" x="3" y="4"/><path d="M3 12h18M12 4v16M7 8h.01M17 16h.01"/></svg>; if (name === 'hours') return <svg className="h-5 w-5" viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></svg>; return <svg className="h-5 w-5" viewBox="0 0 24 24" {...common}><circle cx="12" cy="12" r="8.5"/><path d="M14.8 8.8c-.5-.5-1.3-.8-2.4-.8-1.6 0-2.6.7-2.6 1.8 0 2.8 5.1 1.1 5.1 4 0 1.1-1 1.9-2.8 1.9-1.1 0-2.1-.3-2.8-1M12 6.3v11.4"/></svg>; }
