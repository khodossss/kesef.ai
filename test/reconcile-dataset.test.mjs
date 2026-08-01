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
      { provider: 'leumi', charged_amount: -800, description: 'חיוב כרטיסי אשראי', date: '2026-06-10' },
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

// Descriptions taken verbatim from a real Leumi statement. The repayment matcher
// missed "מאסטרקרד" (spelled WITH an alef by the bank) because the pattern only
// carried the alef-less "מסטרקרד" — the lump card debits then vanished from
// cardRepaymentsDebited, which is the figure that keeps card spending from being
// double-counted against the balance change.
test('card repayments match the descriptions Leumi actually writes', () => {
  const debits = ['ל.מאסטרקרד(כא)', 'לאומי ויזה(כא)', 'חיוב כאל', 'ישראכרט'].map((description, i) => ({
    provider: 'leumi',
    charged_amount: -100,
    description,
    date: `2026-06-1${i}`,
  }));
  const r = reconcileDataset({
    accounts: [{ provider: 'leumi', balance: 0 }],
    transactions: [
      ...debits,
      // Debit-card charges hit the account directly — they are NOT a card bill
      // repayment and must stay out of the figure.
      { provider: 'leumi', charged_amount: -70, description: 'כרטיס דביט', date: '2026-06-20' },
      { provider: 'leumi', charged_amount: -60, description: 'דמי כרטיס דביט', date: '2026-06-21' },
      // "כאלה" ("such") merely contains the letters of Cal — must not match.
      { provider: 'leumi', charged_amount: -40, description: 'הוצאות כאלה ואחרות', date: '2026-06-22' },
    ],
    banks: ['leumi'],
    cards: ['cal'],
    from: '2026-06-01',
    to: '2026-06-30',
    now: NOW,
  });
  assert.equal(r.ledger.cardRepaymentsDebited, -400); // all four card debits, nothing else
});
