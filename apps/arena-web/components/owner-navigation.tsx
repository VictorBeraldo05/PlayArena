'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type IconName = 'dashboard' | 'agenda' | 'arena' | 'profile';

function NavigationIcon({ name }: { name: IconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, strokeWidth: 1.8 };

  if (name === 'dashboard') return <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" {...common}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>;
  if (name === 'agenda') return <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" {...common}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></svg>;
  if (name === 'arena') return <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" {...common}><path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-5h6v5M8 10h.01M12 10h.01M16 10h.01" /></svg>;
  return <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4 3.5-6 8-6s7.2 2 8 6" /></svg>;
}

const items: Array<{ label: string; icon: IconName; href: string; active: (path: string) => boolean }> = [
  { label: 'Dashboard', icon: 'dashboard', href: '/dashboard', active: (path) => path === '/dashboard' },
  { label: 'Agenda', icon: 'agenda', href: '/dashboard/agenda', active: (path) => path === '/dashboard/agenda' || path.startsWith('/dashboard/agenda/') || path === '/dashboard/reservas' || path.startsWith('/dashboard/reservas/') },
  { label: 'Minha arena', icon: 'arena', href: '/dashboard/minha-arena', active: (path) => path.startsWith('/dashboard/minha-arena') || ['/dashboard/quadras', '/dashboard/horarios', '/dashboard/precos', '/dashboard/arena'].some((route) => path === route || path.startsWith(`${route}/`)) },
  { label: 'Perfil', icon: 'profile', href: '/dashboard/perfil', active: (path) => path === '/dashboard/perfil' || path.startsWith('/dashboard/perfil/') },
];

export function OwnerNavigation() {
  const pathname = usePathname();
  return <nav aria-label="Navegação do proprietário" className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[#111923]/95 px-2 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur"><div className="mx-auto grid max-w-[640px] grid-cols-4">{items.map((item) => { const active = item.active(pathname); return <Link aria-current={active ? 'page' : undefined} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[10px] font-bold leading-3 sm:text-xs ${active ? 'text-[#8FFF3C]' : 'text-[#9DA7B3]'}`} href={item.href} key={item.href}><NavigationIcon name={item.icon} /><span>{item.label}</span></Link>; })}</div></nav>;
}
