import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayName, newMemberId } from '../src/household/identity.mjs';

test('displayName falls back to Юзер N when info is empty', () => {
  assert.equal(displayName({ id: 'm_1', info: 'Дима' }, 0), 'Дима');
  assert.equal(displayName({ id: 'm_2', info: '' }, 1), 'Юзер 2');
  assert.equal(displayName({ id: 'm_3' }, 2), 'Юзер 3');
});

test('member ids are unique and prefixed', () => {
  const a = newMemberId();
  assert.match(a, /^m_[A-Za-z0-9_-]{8}$/);
  assert.notEqual(a, newMemberId());
});
