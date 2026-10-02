export type PublicArena = {
  name: string;
  description: string | null;
  logo_path?: string | null;
  address: string;
  city: string;
  state: string;
  phone: string | null;
  whatsapp: string | null;
  courts: {
    id: string;
    name: string;
    default_duration_minutes: number;
    sports: string[];
    price_from: string | null;
  }[];
  opening_hours: { weekday: number; open_time: string; close_time: string }[];
};

export const PUBLIC_ARENA_CACHE_MS = 60_000;

const entries = new Map<string, { data: PublicArena; savedAt: number }>();
const requests = new Map<string, Promise<PublicArena>>();
let generation = 0;

export function publicArenaCacheKey(arenaId: string) {
  return `arena:${arenaId}`;
}

export function readPublicArenaCache(arenaId: string, now = Date.now()) {
  const entry = entries.get(publicArenaCacheKey(arenaId));
  return entry && now - entry.savedAt < PUBLIC_ARENA_CACHE_MS ? entry.data : null;
}

export function fetchPublicArena(arenaId: string, fetcher: () => Promise<PublicArena>) {
  const cached = readPublicArenaCache(arenaId);
  if (cached) return Promise.resolve(cached);

  const key = publicArenaCacheKey(arenaId);
  const pending = requests.get(key);
  if (pending) return pending;

  const startedAtGeneration = generation;
  const request = Promise.resolve().then(fetcher).then((data) => {
    if (generation === startedAtGeneration) entries.set(key, { data, savedAt: Date.now() });
    return data;
  }).finally(() => {
    if (requests.get(key) === request) requests.delete(key);
  });
  requests.set(key, request);
  return request;
}

export function clearPublicArenaCache() {
  generation += 1;
  entries.clear();
  requests.clear();
}
