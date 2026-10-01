import type { Arena } from '@playarena/types';

export const OWNER_ARENA_STALE_MS = 2 * 60 * 1000;

type ArenaEntry = { data: Arena; savedAt: number };

const entries = new Map<string, ArenaEntry>();
const requests = new Map<string, Promise<Arena>>();
const revisions = new Map<string, number>();
let generation = 0;

export function ownerArenaCacheKey(userId: string, arenaId: string) {
  return `owner-arena:${userId}:${arenaId}`;
}

export function readOwnerArenaCache(userId: string, arenaId: string, now = Date.now()) {
  const entry = entries.get(ownerArenaCacheKey(userId, arenaId));
  return entry ? { data: entry.data, fresh: now - entry.savedAt < OWNER_ARENA_STALE_MS } : null;
}

export function setOwnerArenaCache(userId: string, arenaId: string, data: Arena, now = Date.now()) {
  const key = ownerArenaCacheKey(userId, arenaId);
  entries.set(key, { data, savedAt: now });
  revisions.set(key, (revisions.get(key) ?? 0) + 1);
}

export function fetchOwnerArena(userId: string, arenaId: string, fetcher: () => Promise<Arena>) {
  const key = ownerArenaCacheKey(userId, arenaId);
  const pending = requests.get(key);
  if (pending) return pending;

  const startedAtGeneration = generation;
  const startedAtRevision = revisions.get(key) ?? 0;
  const request = Promise.resolve().then(fetcher).then((data) => {
    if (generation !== startedAtGeneration) return data;
    if ((revisions.get(key) ?? 0) !== startedAtRevision) return entries.get(key)?.data ?? data;
    setOwnerArenaCache(userId, arenaId, data);
    return data;
  }).finally(() => {
    if (requests.get(key) === request) requests.delete(key);
  });
  requests.set(key, request);
  return request;
}

export function clearOwnerArenaCache() {
  generation += 1;
  entries.clear();
  requests.clear();
  revisions.clear();
}
