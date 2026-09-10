'use client';

import { supabase } from './supabase';

export const analyticsEventNames = [
  'app_opened', 'search_started', 'availability_searched', 'availability_results_viewed',
  'availability_no_results', 'arena_viewed', 'reservation_started', 'reservation_login_required',
] as const;

export type AnalyticsEventName = (typeof analyticsEventNames)[number];
type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

const ANONYMOUS_KEY = 'playarena_analytics_anonymous_id';
const SESSION_KEY = 'playarena_analytics_session';
const SESSION_IDLE_MS = 30 * 60 * 1000;
const sent = new Set<string>();

function identifier(key: string) {
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  window.localStorage.setItem(key, value);
  return value;
}

function sessionId() {
  const stored = window.sessionStorage.getItem(SESSION_KEY);
  const [id, lastSeen] = stored?.split(':') ?? [];
  const now = Date.now();
  const next = id && Number(lastSeen) + SESSION_IDLE_MS > now ? id : crypto.randomUUID();
  window.sessionStorage.setItem(SESSION_KEY, `${next}:${now}`);
  return next;
}

export function trackEvent(name: AnalyticsEventName, input: { arenaId?: string; courtId?: string; sportId?: number; reservationId?: string; properties?: AnalyticsProperties; dedupeKey?: string } = {}) {
  if (typeof window === 'undefined') return;
  const dedupeKey = input.dedupeKey ?? `${name}:${location.pathname}:${JSON.stringify(input.properties ?? {})}`;
  if (sent.has(dedupeKey)) return;
  sent.add(dedupeKey);
  const properties = Object.fromEntries(Object.entries(input.properties ?? {}).filter(([, value]) => value !== undefined));
  void supabase.auth.getSession().then(({ data }) => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
    return fetch(`${base}/analytics/events`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', ...(data.session ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
      body: JSON.stringify({ event_name: name, anonymous_id: identifier(ANONYMOUS_KEY), session_id: sessionId(), arena_id: input.arenaId, court_id: input.courtId, sport_id: input.sportId, reservation_id: input.reservationId, properties }),
    }).catch(() => undefined);
  }).catch(() => undefined);
}
