import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newHouseholdId, newSecret, formatToken, parseToken } from '../src/household/token.mjs';

test('format/parse round-trips', () => {
  const householdId = newHouseholdId();
  const secret = newSecret();
  const token = formatToken({ householdId, secret });
  assert.match(token, /^kesef1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(parseToken(token), { householdId, secret });
});

test('ids are random and correctly sized', () => {
  assert.notEqual(newHouseholdId(), newHouseholdId());
  // 16 bytes base64url = 22 chars, 32 bytes = 43 chars (no padding)
  assert.equal(newHouseholdId().length, 22);
  assert.equal(newSecret().length, 43);
});

test('parseToken rejects malformed input', () => {
  assert.throws(() => parseToken('nope'), /invalid token/);
  assert.throws(() => parseToken('kesef1.onlyone'), /invalid token/);
  assert.throws(() => parseToken('wrong.a.b'), /invalid token/);
});
