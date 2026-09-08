import { supabase } from './supabase';

export const ARENA_ASSETS_BUCKET = 'arena-assets';
export const MAX_ARENA_LOGO_BYTES = 5 * 1024 * 1024;
export const ARENA_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export function arenaLogoPath(arenaId: string, mimeType: string) {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `arenas/${arenaId}/logo.${extension}`;
}

export function getArenaLogoUrl(path: string | null | undefined, version?: string) {
  if (!path) return null;
  const { data } = supabase.storage.from(ARENA_ASSETS_BUCKET).getPublicUrl(path);
  return version ? `${data.publicUrl}?v=${encodeURIComponent(version)}` : data.publicUrl;
}
