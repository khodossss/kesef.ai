import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, deriveVerifier, seal, open } from '../src/household/crypto.mjs';

test('seal/open round-trips', () => {
  const key = deriveKey('s'.repeat(43), 'household-abc');
  const plaintext = JSON.stringify({ hello: 'мир', n: 42 });
  const blob = open(key, seal(key, plaintext));
  assert.equal(blob, plaintext);
});

test('open fails on tamper', () => {
  const key = deriveKey('secret', 'hid');
  const sealed = JSON.parse(seal(key, 'data'));
  sealed.ct = Buffer.from('evil').toString('base64');
  assert.throws(() => open(key, JSON.stringify(sealed)));
});

test('key depends on both secret and householdId', () => {
  assert.notDeepEqual(deriveKey('a', 'x'), deriveKey('b', 'x'));
  assert.notDeepEqual(deriveKey('a', 'x'), deriveKey('a', 'y'));
});

test('verifier is derivable and stable, and is not the key', () => {
  const v = deriveVerifier('secret');
  assert.equal(v, deriveVerifier('secret'));
  assert.notEqual(v, deriveKey('secret', 'hid').toString('base64url'));
});
