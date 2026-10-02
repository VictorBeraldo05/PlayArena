import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const source = readFileSync(fileURLToPath(new URL('../lib/public-arena-cache.ts', import.meta.url)), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const cache = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const arena = (name) => ({ name, courts: [] });

test.beforeEach(() => cache.clearPublicArenaCache());

test('detail to hours reuses the arena response within 60 seconds', async () => {
  let calls = 0;
  const fetcher = async () => { calls += 1; return arena('Boleiros'); };
  await cache.fetchPublicArena('arena-a', fetcher);
  assert.equal(cache.readPublicArenaCache('arena-a')?.name, 'Boleiros');
  await cache.fetchPublicArena('arena-a', fetcher);
  assert.equal(calls, 1);
  assert.equal(cache.readPublicArenaCache('arena-b'), null);
});

test('expired arena detail is fetched again', async () => {
  let calls = 0;
  await cache.fetchPublicArena('arena-a', async () => { calls += 1; return arena('Antiga'); });
  assert.equal(cache.readPublicArenaCache('arena-a', Date.now() + cache.PUBLIC_ARENA_CACHE_MS), null);
  // A later request sees the expired entry and calls the API again.
  const originalNow = Date.now;
  Date.now = () => originalNow() + cache.PUBLIC_ARENA_CACHE_MS + 1;
  try {
    await cache.fetchPublicArena('arena-a', async () => { calls += 1; return arena('Atual'); });
    assert.equal(calls, 2);
    assert.equal(cache.readPublicArenaCache('arena-a')?.name, 'Atual');
  } finally { Date.now = originalNow; }
});

test('concurrent deep-link fetches share one request; failures are not cached', async () => {
  let resolve;
  let calls = 0;
  const fetcher = () => { calls += 1; return new Promise((done) => { resolve = done; }); };
  const first = cache.fetchPublicArena('arena-a', fetcher);
  const second = cache.fetchPublicArena('arena-a', fetcher);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve(arena('Boleiros'));
  assert.equal((await first).name, 'Boleiros');
  assert.equal((await second).name, 'Boleiros');

  await assert.rejects(cache.fetchPublicArena('arena-b', async () => { throw new Error('offline'); }));
  assert.equal(cache.readPublicArenaCache('arena-b'), null);
});

test('clearing prevents an older in-flight response from repopulating cache', async () => {
  let resolve;
  const pending = cache.fetchPublicArena('arena-a', () => new Promise((done) => { resolve = done; }));
  await Promise.resolve();
  cache.clearPublicArenaCache();
  resolve(arena('Antiga'));
  await pending;
  assert.equal(cache.readPublicArenaCache('arena-a'), null);
});
