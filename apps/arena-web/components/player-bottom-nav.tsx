'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from './use-auth';

const items = [
  { label: 'Buscar', href: '/buscar', icon: SearchIcon, public: true, active: (path: string) => path === '/buscar' || path === '/player' || path.startsWith('/player/arenas/') },
  { label: 'Nova reserva', href: '/nova-reserva', icon: PlusIcon, public: true, featured: true, active: (path: string) => path === '/nova-reserva' || path.startsWith('/nova-reserva/') || path === '/reservar' || path.startsWith('/reservar/') || path.startsWith('/buscar/disponibilidade') || path.startsWith('/buscar/resultados') },
  { label: 'Reservas', href: '/player/reservas', icon: CalendarIcon, active: (path: string) => path === '/player/reservas' || path.startsWith('/player/reservas/') },
  { label: 'Perfil', href: '/player/perfil', icon: UserIcon, active: (path: string) => path === '/player/perfil' || path.startsWith('/player/perfil/') },
];

export function PlayerBottomNav() {
  const pathname = usePathname();
  const { session } = useAuth();
  return <nav aria-label="Navegação principal" className="player-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-white/[.06] bg-[#111923]/95 px-3 pb-[max(.65rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur"><div className="mx-auto grid max-w-[640px] grid-cols-4">{items.map((item) => { const active = item.active(pathname); const href = session || item.public ? item.href : `/login?returnTo=${encodeURIComponent(pathname)}`; const Icon = item.icon; return <Link aria-current={active ? 'page' : undefined} className={`player-bottom-nav-item ${active ? 'is-active' : ''} ${item.featured ? 'is-featured' : ''}`} href={href} key={item.href}><span className="player-bottom-nav-indicator" /><Icon /><span>{item.label}</span></Link>; })}</div></nav>;
}

function SearchIcon() { return <svg aria-hidden="true" fill="none" height="23" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="23"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg>; }
function PlusIcon() { return <svg aria-hidden="true" fill="none" height="23" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="23"><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></svg>; }
function CalendarIcon() { return <svg aria-hidden="true" fill="none" height="23" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="23"><rect height="16" rx="3" width="18" x="3" y="5" /><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" /></svg>; }
function UserIcon() { return <svg aria-hidden="true" fill="none" height="23" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="23"><circle cx="12" cy="8" r="4" /><path d="M4 21c.8-4 3.5-6 8-6s7.2 2 8 6" /></svg>; }
