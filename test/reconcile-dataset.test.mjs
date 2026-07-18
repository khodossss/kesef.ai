import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDataset } from '../src/store.mjs';

const NOW = '2026-07-01T00:00:00Z';

test('currentBalance sums account balances; pending is future card debits', () => {
  const r = reconcileDataset({
    accounts: [
      { provider: 'leumi', balance: 1000 },
      { provider: 'leumi', balance: null },
    ],
    transactions: [
      { provider: 'isracard', charged_amount: -50, processed_date: '2026-08-01T00:00:00Z' }, // future → pending
      { provider: 'isracard', charged_amount: -30, processed_date: '2026-06-01T00:00:00Z' }, // past → not pending
    ],
    banks: ['leumi'],
    cards: ['isracard'],
    now: NOW,
  });
  assert.equal(r.currentBalance, 1000);
  assert.equal(r.pendingCardBill, -50);
  assert.equal(r.pendingCount, 1);
  assert.equal(r.availableBalance, 950);
  assert.equal(r.ledger, null);
});

test('ledger separates card repayments (bank) from card consumption', () => {
  const r = reconcileDataset({
    accounts: [{ provider: 'leumi', balance: 500 }],
    transactions: [
      { provider: 'leumi', charged_amount: -800, description: 'חיוב כרטיס אשראי', date: '2026-06-10' },
      { provider: 'isracard', charged_amount: -300, date: '2026-06-05' },
      { provider: 'isracard', charged_amount: -500, date: '2026-06-06' },
    ],
    banks: ['leumi'],
    cards: ['isracard'],
    from: '2026-06-01',
    to: '2026-06-30',
    now: NOW,
  });
  assert.equal(r.ledger.cardRepaymentsDebited, -800); // the lump bank debit
  assert.equal(r.ledger.cardConsumption, -800); // itemized card purchases (−300 + −500)
  assert.equal(r.ledger.ledgerNet, -800);
});
