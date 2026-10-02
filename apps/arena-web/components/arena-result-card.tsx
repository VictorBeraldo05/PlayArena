'use client';

import { useState } from 'react';

import { formatCurrencyBRL, formatTimeBR } from '../lib/format';
import { ArenaMedia } from './arena-media';

export type AvailabilityOption = { arena_id: string; arena_name: string; logo_path?: string | null; court_id: string; court_name: string; start_at: string; end_at: string; duration_minutes: number; price: string | number; distance_km?: number | null };
export type ArenaAvailabilityGroup = { id: string; name: string; logo_path?: string | null; options: AvailabilityOption[]; imageUrl?: string; distanceKm?: number; rating?: number; reviewsCount?: number; amenities?: string[] };

function optionPrice(option: AvailabilityOption): number {
  if (option.price === null || option.price === undefined || option.price === '') return Infinity;
  const price = Number(option.price);
  return Number.isFinite(price) && price >= 0 ? price : Infinity;
}

function compactPrice(price: string | number): string {
  return formatCurrencyBRL(price).replace(/,00$/, '');
}

function formatDistance(distance: number): string {
  if (distance < 1) return `${Math.round(distance * 1000)} m`;
  return `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(distance)} km`;
}

export function ArenaResultCard({ group, onReserve, sportName, searchedTime, priorityMedia = false }: { group: ArenaAvailabilityGroup; onReserve: (option: AvailabilityOption) => void; sportName: string; searchedTime: string; priorityMedia?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const options = [...group.options].sort((a, b) => optionPrice(a) - optionPrice(b));
  const visibleOptions = expanded ? options : options.slice(0, 2);
  const hiddenCount = options.length - 2;
  const availableCourtsLabel = `${group.options.length} ${group.options.length === 1 ? 'campo disponível' : 'campos disponíveis'}`;

  return <article className="overflow-hidden rounded-[19px] border border-white/[0.09] bg-[#111923] shadow-[0_10px_28px_rgba(0,0,0,0.16)]">
    <div className="flex min-w-0 items-center gap-3 p-3.5 pb-3">
      <ArenaMedia arena={{ name: group.name, logo_path: group.logo_path, photo_url: group.imageUrl }} className="h-[76px] w-[76px] shrink-0 rounded-[13px] border border-white/[0.08]" priority={priorityMedia} sport={sportName} variant="thumbnail" />
      <div className="min-w-0 flex-1">
        <h2 className="break-words text-[17px] font-extrabold leading-[1.2] tracking-[-0.025em] text-white">{group.name}</h2>
        <p className="mt-1.5 text-[12px] font-medium text-[#B3BFCA]">{availableCourtsLabel}</p>
        <p className="mt-0.5 text-[11px] text-[#86939F]">{sportName}{group.distanceKm !== undefined ? ` · ${formatDistance(group.distanceKm)}` : ''}</p>
      </div>
      {group.rating ? <span className="self-start whitespace-nowrap text-[12px] font-bold text-[#EFC45A]" aria-label={`Avaliação ${group.rating.toLocaleString('pt-BR')}`}>★ {group.rating.toLocaleString('pt-BR')}</span> : null}
    </div>
    <div className="border-t border-white/[0.07] px-2.5 pb-2.5">
      {visibleOptions.map((option) => {
        const price = optionPrice(option);
        const available = Number.isFinite(price);
        const startTime = formatTimeBR(option.start_at);
        const differsFromSearch = startTime !== searchedTime;
        const priceLabel = available ? compactPrice(option.price) : 'Preço indisponível';
        return <button
          aria-label={`${option.court_name}, ${option.duration_minutes} minutos${differsFromSearch ? `, ${startTime}` : ''}, ${priceLabel}${available ? ', reservar' : ', indisponível'}`}
          className="group flex min-h-[54px] w-full items-center justify-between gap-2 rounded-[11px] px-2.5 text-left transition-colors hover:bg-[#1B2932] active:bg-[#21333B] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#8FFF3C] disabled:cursor-not-allowed disabled:opacity-55"
          disabled={!available}
          key={`${option.court_id}-${option.start_at}`}
          onClick={() => onReserve(option)}
          type="button"
        >
          <span className="flex min-w-0 flex-1 flex-col justify-center py-1.5">
            <span className="break-words text-[13px] font-bold leading-[1.25] text-white">{option.court_name}</span>
            <span className="mt-0.5 text-[11px] leading-[1.25] text-[#95A3B0]">{differsFromSearch ? `${startTime} · ` : ''}{option.duration_minutes} min</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <span className={`whitespace-nowrap text-[13px] font-extrabold tabular-nums ${available ? 'text-white' : 'text-[#95A3B0]'}`}>{priceLabel}</span>
            <svg aria-hidden="true" className="h-4 w-4 text-[#8FFF3C] transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" /></svg>
          </span>
        </button>;
      })}
      {hiddenCount > 0 ? <button aria-expanded={expanded} className="flex min-h-11 w-full items-center justify-center gap-1 rounded-[11px] text-[12px] font-bold text-[#B8D7C2] transition-colors hover:bg-[#1B2932] hover:text-[#8FFF3C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8FFF3C]" onClick={() => setExpanded((current) => !current)} type="button">{expanded ? 'Mostrar menos' : `+ ${hiddenCount} ${hiddenCount === 1 ? 'opção' : 'opções'} nesta arena`}<span aria-hidden="true" className={`ml-0.5 transition-transform ${expanded ? 'rotate-180' : ''}`}>⌄</span></button> : null}
    </div>
  </article>;
}
