import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const source = readFileSync(fileURLToPath(new URL('../lib/auth-hydration.ts', import.meta.url)), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createAuthHydrationGate, loadAuthData } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const session = (token = 'test-access-token') => ({ access_token: token, user: { id: 'owner-test' } });

function fakeClient(profileResponse = { data: { id: 'owner-test', role: 'arena_owner' }, error: null, status: 200 }) {
  const requests = [];
  return {
    requests,
    from(table) {
      const request = { table, authorization: null };
      requests.push(request);
      const result = table === 'profiles' ? profileResponse : { data: [{ arenas: { id: 'arena-test' } }], error: null, status: 200 };
      const builder = {
        select() { return this; },
        eq() { return this; },
        order() { return this; },
        setHeader(name, value) {
          if (name === 'Authorization') request.authorization = value;
          return this;
        },
        single() { return Promise.resolve(result); },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
      return builder;
    },
  };
}

test('A: login session hydrates profile and owner links with the same bearer', async () => {
  const gate = createAuthHydrationGate();
  const decision = gate.receive('SIGNED_IN', session());
  assert.equal(decision.kind, 'hydrate');
  const client = fakeClient();
  const data = await loadAuthData(client, decision.session);
  assert.equal(gate.complete(decision.version, decision.session.user.id, true), true);
  assert.equal(data.profile.role, 'arena_owner');
  assert.equal(data.ownedArenas[0].id, 'arena-test');
  assert.deepEqual(client.requests.map((request) => request.authorization), ['Bearer test-access-token', 'Bearer test-access-token']);
});

test('B: concurrent auth event does not start a duplicate or tokenless profile request', async () => {
  const gate = createAuthHydrationGate();
  const first = gate.receive('SIGNED_IN', session());
  assert.equal(gate.receive('INITIAL_SESSION', session()).kind, 'pending');
  const refreshed = gate.receive('TOKEN_REFRESHED', session('refreshed-test-token'));
  assert.equal(refreshed.kind, 'hydrate');
  assert.equal(gate.complete(first.version, 'owner-test', true), false);
  const client = fakeClient();
  await loadAuthData(client, refreshed.session);
  assert.equal(gate.complete(refreshed.version, 'owner-test', true), true);
  assert.equal(client.requests.filter((request) => request.table === 'profiles').length, 1);
  assert.equal(client.requests[0].authorization, 'Bearer refreshed-test-token');
  assert.equal(gate.receive('SIGNED_IN', { user: { id: 'owner-test' } }).kind, 'invalid-session');
  await assert.rejects(loadAuthData(client, { user: { id: 'owner-test' } }), /auth_session_missing_token/);
  assert.equal(client.requests.length, 2);
});

test('C: refresh of a ready user updates the session without clearing profile', async () => {
  const gate = createAuthHydrationGate();
  const initial = gate.receive('INITIAL_SESSION', session());
  assert.equal(gate.complete(initial.version, 'owner-test', true), true);
  const refreshed = gate.receive('TOKEN_REFRESHED', session('refreshed-test-token'));
  assert.equal(refreshed.kind, 'ready');
  assert.equal(refreshed.session.access_token, 'refreshed-test-token');
});

test('D: owner deep link can resolve after authenticated profile hydration', async () => {
  const reservation = '50000000-0000-0000-0000-000000000001';
  const returnTo = `/dashboard/reservas?reservation=${reservation}`;
  const gate = createAuthHydrationGate();
  assert.equal(gate.receive('INITIAL_SESSION', null).kind, 'signed-out');
  const login = gate.receive('SIGNED_IN', session());
  const { profile, ownedArenas } = await loadAuthData(fakeClient(), login.session);
  assert.equal(gate.complete(login.version, login.session.user.id, true), true);
  assert.equal(profile.role, 'arena_owner');
  assert.equal(ownedArenas.length, 1);
  assert.equal(new URL(`/login?returnTo=${encodeURIComponent(returnTo)}`, 'https://playarena.test').searchParams.get('returnTo'), returnTo);
});

test('E: legitimate 401 surfaces as an error and never triggers an automatic retry', async () => {
  const gate = createAuthHydrationGate();
  const decision = gate.receive('SIGNED_IN', session());
  const client = fakeClient({ data: null, error: new Error('JWT rejected'), status: 401 });
  await assert.rejects(loadAuthData(client, decision.session), /JWT rejected/);
  assert.equal(gate.complete(decision.version, decision.session.user.id, false), true);
  assert.equal(client.requests.filter((request) => request.table === 'profiles').length, 1);
});
