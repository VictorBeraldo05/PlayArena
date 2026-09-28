import assert from 'node:assert/strict';
import test from 'node:test';

import { pixExpiryState } from '../lib/pix-expiration.mjs';

const createdAt = Date.parse('2026-09-28T18:00:00Z');
const expiresAt = new Date(createdAt + 30 * 60_000).toISOString();
const pendingPix = {
  status: 'pending',
  expires_at: new Date(createdAt + 31 * 60_000).toISOString(),
  instructions: { expires_at: expiresAt },
};

test('waiting_transfer remains pending at T+2, T+4 and T+6 seconds', () => {
  for (const elapsed of [2, 4, 6]) {
    const state = pixExpiryState(pendingPix, createdAt + elapsed * 1000);
    assert.equal(state.expired, false);
    assert.ok(state.secondsLeft > 0);
  }
});

test('stopping automatic polling does not expire a future Pix', () => {
  assert.equal(pixExpiryState(pendingPix, createdAt + 180_000).expired, false);
});

test('invalid deadline cannot turn a pending Pix into expired', () => {
  assert.deepEqual(
    pixExpiryState({ ...pendingPix, instructions: { expires_at: 'invalid' } }, createdAt + 6000),
    { secondsLeft: null, expired: false },
  );
});

test('local past deadline or backend expired status expires the Pix', () => {
  assert.equal(pixExpiryState(pendingPix, createdAt + 30 * 60_000).expired, true);
  assert.equal(pixExpiryState({ ...pendingPix, status: 'expired' }, createdAt + 6000).expired, true);
});
