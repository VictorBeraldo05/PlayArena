import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const source = readFileSync(fileURLToPath(new URL('../lib/auth-routing.ts', import.meta.url)), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { safeInternalPath } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('owner reservation deep link survives login returnTo', () => {
  const link = '/dashboard/reservas?reservation=50000000-0000-0000-0000-000000000001';
  const loginUrl = `/login?returnTo=${encodeURIComponent(link)}`;
  assert.equal(safeInternalPath(new URL(loginUrl, 'https://useplayarena.com.br').searchParams.get('returnTo')), link);
});

test('external and ambiguous returnTo values are rejected', () => {
  for (const value of [
    'https://evil.example/dashboard',
    '//evil.example/dashboard',
    '/\\evil.example/dashboard',
    '/%2fevil.example/dashboard',
    '/%5cevil.example/dashboard',
    '/dashboard\n/reservas',
  ]) {
    assert.equal(safeInternalPath(value), null, value);
  }
});
