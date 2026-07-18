import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshots, householdReconcile, householdAccounts } from '../src/household/merge.mjs';

const NOW = '2026-07-01T00:00:00Z';

const dima = {
  member: { id: 'm_dima', info: 'Дима' },
  exported_at: '2026-06-30T10:00:00Z',
  providers: [
    { provider: 'leumi', kind: 'bank' },
    { provider: 'isracard', kind: 'card' },
  ],
  accounts: [{ provider: 'leumi', account_number: '1', balance: 1000 }],
  transactions: [{ provider: 'isracard', charged_amount: -50, processed_date: '2026-08-01T00:00:00Z' }],
  refreshes: [],
};
const wife = {
  member: { id: 'm_wife', info: 'Жена' },
  exported_at: '2026-06-30T09:00:00Z',
  providers: [{ provider: 'leumi', kind: 'bank' }], // SAME bank as Dima — must not collide
  accounts: [{ provider: 'leumi', account_number: '1', balance: 200 }],
  transactions: [],
  refreshes: [],
};

test('mergeSnapshots dedups by member.id, later export wins', () => {
  const stale = { ...dima, exported_at: '2026-06-01T00:00:00Z', accounts: [{ provider: 'leumi', balance: 5 }] };
  const merged = mergeSnapshots([stale, dima, wife]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(s => s.member.id === 'm_dima').accounts[0].balance, 1000);
});

test('same bank across members does not collide; household sums per-member', () => {
  const accts = householdAccounts([dima, wife]);
  assert.equal(accts.length, 2); // both leumi/acct 1, but tagged by member
  assert.deepEqual(accts.map(a => a.member.id).sort(), ['m_dima', 'm_wife']);

  const r = householdReconcile([dima, wife], { now: NOW });
  assert.equal(r.perMember.length, 2);
  assert.equal(r.household.currentBalance, 1200); // 1000 + 200
  assert.equal(r.household.pendingCardBill, -50); // only Dima has a future card debit
  assert.equal(r.household.availableBalance, 1150);
});
