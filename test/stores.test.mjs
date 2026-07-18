import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeStore } from '../src/household/stores.mjs';

test('LocalStore push/pullAll/remove round-trips via the filesystem', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kesef-'));
  try {
    const store = makeStore({ storage: 'local', dir });
    await store.push('m_a', '{"member":{"id":"m_a"}}');
    await store.push('m_b', '{"member":{"id":"m_b"}}');
    const all = await store.pullAll();
    assert.deepEqual(all.map(x => x.memberId).sort(), ['m_a', 'm_b']);
    assert.equal(all.find(x => x.memberId === 'm_a').bytes, '{"member":{"id":"m_a"}}');
    await store.remove('m_a');
    const after = await store.pullAll();
    assert.deepEqual(
      after.map(x => x.memberId),
      ['m_b'],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
