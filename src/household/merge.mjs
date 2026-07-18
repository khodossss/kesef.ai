// Household aggregation over member snapshots. Reconciliation runs PER MEMBER
// (card repayments match bank↔card only inside one member) and the household
// figures are the sum — never a cross-member match.
import { reconcileDataset } from '../store.mjs';

const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

export function mergeSnapshots(snapshots) {
  const byMember = new Map();
  for (const s of snapshots) {
    if (!s || !s.member || !s.member.id) continue;
    const prev = byMember.get(s.member.id);
    if (!prev || (s.exported_at || '') > (prev.exported_at || '')) byMember.set(s.member.id, s);
  }
  return [...byMember.values()].sort(
    (a, b) => (a.exported_at || '').localeCompare(b.exported_at || '') || a.member.id.localeCompare(b.member.id),
  );
}

export function householdAccounts(snapshots) {
  return mergeSnapshots(snapshots).flatMap(s => s.accounts.map(a => ({ member: s.member, ...a })));
}

export function householdTransactions(snapshots, { from, to, search, limit = 500 } = {}) {
  let rows = mergeSnapshots(snapshots).flatMap(s => s.transactions.map(t => ({ member: s.member, ...t })));
  if (from) rows = rows.filter(t => t.date && t.date >= from);
  if (to) rows = rows.filter(t => t.date && t.date <= to);
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(t => `${t.description || ''} ${t.memo || ''}`.toLowerCase().includes(q));
  }
  rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return rows.slice(0, limit);
}

function providerSets(snapshot) {
  const banks = snapshot.providers.filter(p => p.kind === 'bank').map(p => p.provider);
  const cards = snapshot.providers.filter(p => p.kind === 'card').map(p => p.provider);
  return { banks, cards };
}

export function householdReconcile(snapshots, { from, to, now } = {}) {
  const merged = mergeSnapshots(snapshots);
  const perMember = merged.map(s => {
    const { banks, cards } = providerSets(s);
    return {
      member: s.member,
      exported_at: s.exported_at,
      last_refresh:
        (s.refreshes || [])
          .map(r => r.last_refresh)
          .sort()
          .pop() || null,
      ...reconcileDataset({ accounts: s.accounts, transactions: s.transactions, banks, cards, from, to, now }),
    };
  });
  const sum = key => r2(perMember.reduce((s, m) => s + (m[key] || 0), 0));
  return {
    perMember,
    household: {
      currentBalance: sum('currentBalance'),
      pendingCardBill: sum('pendingCardBill'),
      availableBalance: sum('availableBalance'),
      pendingCount: perMember.reduce((s, m) => s + (m.pendingCount || 0), 0),
    },
  };
}
