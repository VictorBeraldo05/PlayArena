'use client';

/* Image cache and fallback events settle the critical-media state from effects. */
/* eslint-disable react-hooks/set-state-in-effect */

/* Dynamic storage URLs need sequential error fallbacks that Next Image cannot provide. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useId, useRef, useState } from 'react';

import { getArenaLogoUrl } from '../lib/arena-logo';
import { PageReadyGate } from '../providers/page-ready-provider';

type ArenaMediaInput = { name: string; logo_path?: string | null; photo_url?: string | null; google_photo_url?: string | null; updated_at?: string | null };
type ArenaMediaSource = 'arena-photo' | 'arena-logo' | 'google' | 'sport-fallback' | 'default';

const sportFallbacks: Record<string, string> = {
  society: '/img/sports/society.png', beachtennis: '/img/sports/beach-tenis.png', futevolei: '/img/sports/futevolei.png', tenis: '/img/sports/tenis1.png', volei: '/img/sports/volei.png',
};

function decodeImage(image: HTMLImageElement | null) { return image?.decode ? image.decode().catch(() => undefined) : Promise.resolve(); }

export function resolveArenaMedia(arena: ArenaMediaInput, sport?: string, prefer: 'logo' | 'default' = 'default') {
  const sources: { src: string; source: ArenaMediaSource; alt: string }[] = [];
  const logo = arena.logo_path ? { src: getArenaLogoUrl(arena.logo_path, arena.updated_at ?? undefined) ?? '', source: 'arena-logo' as const, alt: `Logo da arena ${arena.name}` } : null;
  const photo = arena.photo_url ? { src: arena.photo_url, source: 'arena-photo' as const, alt: `Foto da arena ${arena.name}` } : null;
  const googlePhoto = arena.google_photo_url ? { src: arena.google_photo_url, source: 'google' as const, alt: `Foto da arena ${arena.name}` } : null;
  if (prefer === 'logo' && logo) sources.push(logo);
  if (photo) sources.push(photo);
  if (googlePhoto) sources.push(googlePhoto);
  if (prefer !== 'logo' && logo) sources.push(logo);
  const sportFallback = sportFallbacks[normalize(sport ?? '')];
  if (sportFallback) sources.push({ src: sportFallback, source: 'sport-fallback', alt: `Imagem de ${sport}` });
  sources.push({ src: '/img/playarena-hero.png', source: 'default', alt: 'Arena PlayArena' });
  return sources.filter((item) => Boolean(item.src));
}

export function ArenaMedia({ arena, sport, className = '', variant = 'card', priority = false, prefer = 'default', critical = false }: { arena: ArenaMediaInput; sport?: string; className?: string; variant?: 'thumbnail' | 'card' | 'hero' | 'ticket' | 'identity'; priority?: boolean; prefer?: 'logo' | 'default'; critical?: boolean }) {
  const sources = resolveArenaMedia(arena, sport, prefer);
  const [index, setIndex] = useState(0);
  const [criticalResolved, setCriticalResolved] = useState(!critical);
  const imageRef = useRef<HTMLImageElement>(null);
  const resourceId = useId();
  const media = sources[Math.min(index, sources.length - 1)];
  const isLogo = media.source === 'arena-logo';
  const objectFit = isLogo ? 'contain' : 'cover';
  const usesLogoBackdrop = isLogo && variant === 'hero';
  useEffect(() => {
    if (!critical) { setCriticalResolved(true); return; }
    setCriticalResolved(false);
    const image = imageRef.current;
    if (!image?.complete) return;
    void decodeImage(image).finally(() => setCriticalResolved(true));
  }, [critical, media.src]);
  function settleImage() { void decodeImage(imageRef.current).finally(() => setCriticalResolved(true)); }
  function handleError() { setIndex((current) => { const next = Math.min(current + 1, sources.length - 1); if (next === current) setCriticalResolved(true); return next; }); }
  return <><PageReadyGate enabled={critical} ready={criticalResolved} resourceId={`arena-media-${resourceId}-${media.src}`} /><div className={`arena-media arena-media-${variant} arena-media-fit-${objectFit} ${isLogo ? 'is-logo' : 'is-photo'} ${className}`}>{usesLogoBackdrop ? <img alt="" aria-hidden="true" className="arena-media-logo-backdrop" src={media.src}/> : null}<img alt={media.alt} className={`${objectFit === 'contain' ? 'object-contain' : 'object-cover'} ${usesLogoBackdrop ? 'arena-media-logo-foreground' : ''}`} fetchPriority={priority ? 'high' : 'auto'} loading={priority ? 'eager' : 'lazy'} onError={handleError} onLoad={settleImage} ref={imageRef} src={media.src} /></div></>;
}

function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
