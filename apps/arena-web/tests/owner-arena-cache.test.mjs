import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const source = readFileSync(fileURLToPath(new URL('../lib/owner-arena-cache.ts', import.meta.url)), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const cache = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const user = 'owner-a';
const arenaId = 'arena-a';
const arena = (name) => ({ id: arenaId, name });

test.beforeEach(() => cache.clearOwnerArenaCache());

test('first visit fetches, return after 10 seconds uses fresh owner-scoped data', async () => {
  let calls = 0;
  assert.equal(cache.readOwnerArenaCache(user, arenaId), null);
  const first = await cache.fetchOwnerArena(user, arenaId, async () => { calls += 1; return arena('Primeira'); });
  assert.equal(first.name, 'Primeira');
  const warm = cache.readOwnerArenaCache(user, arenaId, Date.now() + 10_000);
  assert.equal(warm?.fresh, true);
  assert.equal(warm?.data.name, 'Primeira');
  assert.equal(calls, 1);
  assert.equal(cache.readOwnerArenaCache('owner-b', arenaId), null);
});

test('stale data remains available during background revalidation', async () => {
  const old = arena('Anterior');
  cache.setOwnerArenaCache(user, arenaId, old, 1_000);
  const stale = cache.readOwnerArenaCache(user, arenaId, 1_000 + cache.OWNER_ARENA_STALE_MS);
  assert.equal(stale?.fresh, false);
  assert.equal(stale?.data, old);
  let complete;
  const pending = cache.fetchOwnerArena(user, arenaId, () => new Promise(resolve => { complete = resolve; }));
  await Promise.resolve();
  assert.equal(cache.readOwnerArenaCache(user, arenaId)?.data, old);
  complete(arena('Atualizada'));
  assert.equal((await pending).name, 'Atualizada');
  assert.equal(cache.readOwnerArenaCache(user, arenaId)?.data.name, 'Atualizada');
});

test('save updates the cache immediately and wins over an older in-flight fetch', async () => {
  cache.setOwnerArenaCache(user, arenaId, arena('Antiga'));
  let complete;
  const pending = cache.fetchOwnerArena(user, arenaId, () => new Promise(resolve => { complete = resolve; }));
  await Promise.resolve();
  cache.setOwnerArenaCache(user, arenaId, arena('Salva'));
  complete(arena('Resposta antiga'));
  assert.equal((await pending).name, 'Salva');
  assert.equal(cache.readOwnerArenaCache(user, arenaId)?.data.name, 'Salva');
});

test('logo update replaces the cached identity without another GET', () => {
  cache.setOwnerArenaCache(user, arenaId, { ...arena('Arena'), logo_path: 'old.png' });
  cache.setOwnerArenaCache(user, arenaId, { ...arena('Arena'), logo_path: 'new.webp' });
  assert.equal(cache.readOwnerArenaCache(user, arenaId)?.data.logo_path, 'new.webp');
  cache.setOwnerArenaCache(user, arenaId, { ...arena('Arena'), logo_path: null });
  assert.equal(cache.readOwnerArenaCache(user, arenaId)?.data.logo_path, null);
});

test('logout clears data and an in-flight response cannot refill the cache', async () => {
  cache.setOwnerArenaCache(user, arenaId, arena('Privada'));
  let complete;
  const pending = cache.fetchOwnerArena(user, arenaId, () => new Promise(resolve => { complete = resolve; }));
  await Promise.resolve();
  cache.clearOwnerArenaCache();
  complete(arena('Antiga'));
  await pending;
  assert.equal(cache.readOwnerArenaCache(user, arenaId), null);
});

test('failed background refresh retains the last valid data', async () => {
  cache.setOwnerArenaCache(user, arenaId, arena('Disponivel'));
  await assert.rejects(cache.fetchOwnerArena(user, arenaId, async () => { throw new Error('Offline'); }));
  assert.equal(cache.readOwnerArenaCache(user, arenaId)?.data.name, 'Disponivel');
});
