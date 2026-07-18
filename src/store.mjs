// Local SQLite store (built-in node:sqlite — no native build).
// One row per (provider, account, transaction); refreshes upsert, so history
// accumulates and re-scraping the same period doesn't duplicate.

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { DATA_DIR, BANK_PROVIDERS, CARD_PROVIDERS } from '../config.mjs';

const db = new DatabaseSync(join(DATA_DIR, 'bank.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    provider TEXT NOT NULL,
    account_number TEXT NOT NULL,
    balance REAL,
    currency TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (provider, account_number)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    provider TEXT NOT NULL,
    account_number TEXT NOT NULL,
    identifier TEXT NOT NULL,
    date TEXT,
    processed_date TEXT,
    charged_amount REAL,
    original_amount REAL,
    currency TEXT,
    description TEXT,
    memo TEXT,
    status TEXT,
    installment_number INTEGER,
    installment_total INTEGER,
    PRIMARY KEY (provider, account_number, identifier, date)
  );
  CREATE TABLE IF NOT EXISTS refreshes (
    provider TEXT PRIMARY KEY,
    last_refresh TEXT,
    accounts INTEGER,
    transactions INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_txn_provider_date ON transactions(provider, date);
`);

const upAccount = db.prepare(`
  INSERT INTO accounts (provider, account_number, balance, currency, updated_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(provider, account_number) DO UPDATE SET
    balance=excluded.balance, currency=excluded.currency, updated_at=excluded.updated_at`);

const upTxn = db.prepare(`
  INSERT INTO transactions
    (provider, account_number, identifier, date, processed_date, charged_amount,
     original_amount, currency, description, memo, status, installment_number, installment_total)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(provider, account_number, identifier, date) DO UPDATE SET
    processed_date=excluded.processed_date, charged_amount=excluded.charged_amount,
    original_amount=excluded.original_amount, currency=excluded.currency,
    description=excluded.description, memo=excluded.memo, status=excluded.status,
    installment_number=excluded.installment_number, installment_total=excluded.installment_total`);

const upRefresh = db.prepare(`
  INSERT INTO refreshes (provider, last_refresh, accounts, transactions)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(provider) DO UPDATE SET
    last_refresh=excluded.last_refresh, accounts=excluded.accounts, transactions=excluded.transactions`);

// Persist a normalized {provider, accounts:[{accountNumber, balance, currency, txns:[...]}]}
export function save(result, nowIso) {
  const { provider, accounts } = result;
  let txnCount = 0;
  const tx = db.prepare('BEGIN');
  tx.run();
  try {
    for (const a of accounts) {
      upAccount.run(provider, a.accountNumber, a.balance ?? null, a.currency ?? null, nowIso);
      for (const t of a.txns || []) {
        upTxn.run(
          provider,
          a.accountNumber,
          String(t.identifier ?? ''),
          t.date ?? null,
          t.processedDate ?? null,
          t.chargedAmount ?? null,
          t.originalAmount ?? null,
          t.currency ?? t.originalCurrency ?? null,
          t.description ?? '',
          t.memo ?? '',
          t.status ?? null,
          t.installment_number ?? t.installments?.number ?? null,
          t.installment_total ?? t.installments?.total ?? null,
        );
        txnCount++;
      }
    }
    upRefresh.run(provider, nowIso, accounts.length, txnCount);
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
  return { accounts: accounts.length, transactions: txnCount };
}

export function listAccounts(provider) {
  const where = provider ? 'WHERE provider = ?' : '';
  return db
    .prepare(`SELECT * FROM accounts ${where} ORDER BY provider, account_number`)
    .all(...(provider ? [provider] : []));
}

export function getTransactions({ provider, from, to, search, limit = 500 } = {}) {
  const clauses = [],
    args = [];
  if (provider) {
    clauses.push('provider = ?');
    args.push(provider);
  }
  if (from) {
    clauses.push('date >= ?');
    args.push(from);
  }
  if (to) {
    clauses.push('date <= ?');
    args.push(to);
  }
  if (search) {
    clauses.push('(description LIKE ? OR memo LIKE ?)');
    args.push(`%${search}%`, `%${search}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  args.push(limit);
  return db.prepare(`SELECT * FROM transactions ${where} ORDER BY date DESC LIMIT ?`).all(...args);
}

export function status() {
  return db.prepare('SELECT * FROM refreshes ORDER BY provider').all();
}

const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

// Balance reconciliation. The account balance moves via the lump card REPAYMENTS,
// not the itemized purchases — so "spending" (Isracard itemized) is a different
// number from the balance change, and must never be summed with the repayments.
// The current balance is also "inflated": recent card purchases aren't billed to
// the account yet. This returns concrete figures for all of that.
// Generic across whatever providers exist: BANK providers carry the balance and
// the lump card-repayment debits; CARD providers carry itemized purchases and
// their future billing dates. No provider is hardcoded.
const CARD_REPAY_RE = /מסטרקרד|כרטיסי אשראי|ישראכרט|לאומי קארד|ויזה|מקס|max|visa|isracard|amex|mastercard/i;

// Pure reconciliation over a supplied dataset (no I/O) — reused for own (local DB)
// and per-member (snapshot) scopes. banks/cards are the provider-name sets.
export function reconcileDataset({ accounts, transactions, banks, cards, from, to, now } = {}) {
  const bankSet = new Set(banks);
  const cardSet = new Set(cards);
  const nowIso = now || new Date().toISOString();

  const currentBalance = r2(accounts.filter(a => a.balance != null).reduce((s, a) => s + a.balance, 0));

  const futureCard = transactions.filter(
    t => cardSet.has(t.provider) && t.charged_amount < 0 && t.processed_date && t.processed_date > nowIso,
  );
  const pendingCardBill = r2(futureCard.reduce((s, t) => s + t.charged_amount, 0)); // negative

  let ledger = null;
  if (from || to) {
    const inPeriod = transactions.filter(
      t => (!from || (t.date && t.date >= from)) && (!to || (t.date && t.date <= to)),
    );
    const bankTx = inPeriod.filter(t => bankSet.has(t.provider));
    const net = r2(bankTx.reduce((s, t) => s + (t.charged_amount || 0), 0));
    const repay = r2(
      bankTx
        .filter(t => t.charged_amount < 0 && CARD_REPAY_RE.test(t.description || ''))
        .reduce((s, t) => s + t.charged_amount, 0),
    );
    const consumption = r2(
      inPeriod.filter(t => cardSet.has(t.provider) && t.charged_amount < 0).reduce((s, t) => s + t.charged_amount, 0),
    );
    ledger = {
      from,
      to,
      banks: [...bankSet],
      cards: [...cardSet],
      ledgerNet: net,
      impliedStartBalance: r2(currentBalance - net),
      cardRepaymentsDebited: repay,
      cardConsumption: consumption,
    };
  }

  return {
    currentBalance,
    pendingCardBill,
    pendingCount: futureCard.length,
    availableBalance: r2(currentBalance + pendingCardBill),
    note: 'availableBalance = currentBalance − upcoming card bill. Card spending (cardConsumption) ≠ balance change: the balance moves via bank card repayments (cardRepaymentsDebited); never sum both.',
    ledger,
  };
}

// own scope: reconcile over the local DB.
export function reconcile({ from, to } = {}) {
  return reconcileDataset({
    accounts: listAccounts(),
    transactions: getTransactions({ limit: 1000000 }),
    banks: BANK_PROVIDERS,
    cards: CARD_PROVIDERS,
    from,
    to,
  });
}

// Build a portable, credential-free snapshot of THIS machine's data.
export function exportSnapshot(member) {
  const accounts = listAccounts();
  const providerNames = [...new Set(accounts.map(a => a.provider))];
  const providers = providerNames.map(p => ({ provider: p, kind: BANK_PROVIDERS.includes(p) ? 'bank' : 'card' }));
  return {
    schema: 1,
    member,
    exported_at: new Date().toISOString(),
    providers,
    accounts,
    transactions: getTransactions({ limit: 1000000 }),
    refreshes: status(),
  };
}
