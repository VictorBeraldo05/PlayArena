'use client';

/* Dynamic storage URLs need sequential error fallbacks that Next Image cannot provide. */
/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';

import { getArenaLogoUrl } from '../lib/arena-logo';

type ArenaMediaInput = { name: string; logo_path?: string | null; photo_url?: string | null; google_photo_url?: string | null; updated_at?: string | null };
type ArenaMediaSource = 'arena-photo' | 'arena-logo' | 'google' | 'sport-fallback' | 'default';

const sportFallbacks: Record<string, string> = {
  society: '/img/sports/society.png', beachtennis: '/img/sports/beach-tenis.png', futevolei: '/img/sports/futevolei.png', tenis: '/img/sports/tenis1.png', volei: '/img/sports/volei.png',
};

export function resolveArenaMedia(arena: ArenaMediaInput, sport?: string) {
  const sources: { src: string; source: ArenaMediaSource; alt: string }[] = [];
  if (arena.photo_url) sources.push({ src: arena.photo_url, source: 'arena-photo', alt: `Foto da arena ${arena.name}` });
  if (arena.logo_path) sources.push({ src: getArenaLogoUrl(arena.logo_path, arena.updated_at ?? undefined) ?? '', source: 'arena-logo', alt: `Logo da arena ${arena.name}` });
  if (arena.google_photo_url) sources.push({ src: arena.google_photo_url, source: 'google', alt: `Foto da arena ${arena.name}` });
  const sportFallback = sportFallbacks[normalize(sport ?? '')];
  if (sportFallback) sources.push({ src: sportFallback, source: 'sport-fallback', alt: `Imagem de ${sport}` });
  sources.push({ src: '/img/playarena-hero.png', source: 'default', alt: 'Arena PlayArena' });
  return sources.filter((item) => Boolean(item.src));
}

export function ArenaMedia({ arena, sport, className = '', variant = 'card', priority = false }: { arena: ArenaMediaInput; sport?: string; className?: string; variant?: 'thumbnail' | 'card' | 'hero' | 'ticket'; priority?: boolean }) {
  const sources = resolveArenaMedia(arena, sport);
  const [index, setIndex] = useState(0);
  const media = sources[Math.min(index, sources.length - 1)];
  const isLogo = media.source === 'arena-logo';
  return <div className={`arena-media arena-media-${variant} ${isLogo ? 'is-logo' : 'is-photo'} ${className}`}><img alt={media.alt} className={isLogo ? 'object-contain' : 'object-cover'} fetchPriority={priority ? 'high' : 'auto'} loading={priority ? 'eager' : 'lazy'} onError={() => setIndex((current) => Math.min(current + 1, sources.length - 1))} src={media.src} /></div>;
}

function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
