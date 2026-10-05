import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const source = readFileSync(fileURLToPath(new URL('../lib/booking-payment-mode.ts', import.meta.url)), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { bookingPaymentMode } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('paid quote keeps checkout mode', () => {
  assert.equal(bookingPaymentMode({ payment_required: true }), 'paid');
});

test('free quote selects direct reservation without checkout UI', () => {
  assert.equal(bookingPaymentMode({ payment_required: false }), 'free');
});

test('no quote does not assume free mode', () => {
  assert.equal(bookingPaymentMode(null), 'loading');
});
