import type { UserRole } from '@playarena/types';

const INTERNAL_ORIGIN = 'https://playarena.internal';

export function authenticatedHome(role: UserRole | null | undefined, ownedArenasCount: number) {
  if (role === 'player') return '/buscar';
  if (role === 'arena_owner') return ownedArenasCount > 0 ? '/dashboard' : '/onboarding';
  if (role === 'admin') return '/admin/analytics';
  return null;
}

export function safeInternalPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return null;

  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN) return null;
    if (/%2f|%5c/i.test(url.pathname)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
