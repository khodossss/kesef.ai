import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncWith, pullSnapshotsWith } from '../src/household/index.mjs';

const snapshot = member => ({
  schema: 1,
  member,
  exported_at: '2026-06-30T10:00:00Z',
  providers: [{ provider: 'leumi', kind: 'bank' }],
  accounts: [{ provider: 'leumi', account_number: '1', balance: 100 }],
  transactions: [],
  refreshes: [],
});

test('local sync writes own snapshot; pull reads all members', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kesef-fam-'));
  try {
    const cfgA = { storage: 'local', dir, member: { id: 'm_a', info: 'A' } };
    const cfgB = { storage: 'local', dir, member: { id: 'm_b', info: 'B' } };
    await syncWith(cfgA, () => snapshot(cfgA.member));
    await syncWith(cfgB, () => snapshot(cfgB.member));
    const snaps = await pullSnapshotsWith(cfgA, () => snapshot(cfgA.member));
    assert.deepEqual(snaps.map(s => s.member.id).sort(), ['m_a', 'm_b']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
