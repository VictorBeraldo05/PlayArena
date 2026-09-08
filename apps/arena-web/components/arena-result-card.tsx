'use client';

import { formatCurrencyBRL, formatTimeBR } from '../lib/format';
import { ArenaMedia } from './arena-media';

export type AvailabilityOption = { arena_id: string; arena_name: string; logo_path?: string | null; court_id: string; court_name: string; start_at: string; end_at: string; duration_minutes: number; price: string | number };
export type ArenaAvailabilityGroup = { id: string; name: string; logo_path?: string | null; options: AvailabilityOption[]; imageUrl?: string; distanceKm?: number; rating?: number; reviewsCount?: number; amenities?: string[] };

export function ArenaResultCard({ group, onReserve, sportName }: { group: ArenaAvailabilityGroup; onReserve: (option: AvailabilityOption) => void; sportName: string }) {
  const availableCourtsLabel = `${group.options.length} ${group.options.length === 1 ? 'campo disponível' : 'campos disponíveis'}`;
  return <article className="overflow-hidden rounded-[20px] border border-white/10 bg-[#111923] shadow-[0_18px_32px_rgba(0,0,0,0.2)]">
    <ArenaMedia arena={{ name: group.name, logo_path: group.logo_path, photo_url: group.imageUrl }} className="aspect-[16/7]" priority sport={sportName} variant="hero" />
    <div className="p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-black tracking-tight text-white">{group.name}</h2><p className="mt-1 text-sm text-[#9DA7B3]">{availableCourtsLabel} · {sportName}</p></div>{group.rating ? <span className="shrink-0 text-sm font-bold text-[#FFC928]">★ {group.rating.toLocaleString('pt-BR')}</span> : null}</div><div className="mt-4 space-y-3">{group.options.map((option) => <div className="rounded-2xl bg-[#18212D] p-3.5" key={option.court_id}><p className="font-bold text-white">{option.court_name}</p><p className="mt-1 text-sm text-[#9DA7B3]">{formatTimeBR(option.start_at)} às {formatTimeBR(option.end_at)} · {option.duration_minutes} min</p><div className="mt-3 flex items-center justify-between gap-3"><p className="text-base font-black text-white">{formatCurrencyBRL(option.price)} <span className="text-sm font-medium text-[#9DA7B3]">/ hora</span></p><button className="min-h-12 rounded-2xl bg-[#8FFF3C] px-5 text-sm font-black text-[#080D14] transition hover:brightness-105" onClick={() => onReserve(option)} type="button">Reservar</button></div></div>)}</div></div>
  </article>;
}
