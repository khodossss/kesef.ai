// Snapshot transport. Two implementations behind one interface; both move opaque
// bytes. LocalStore = plaintext JSON files in a user-synced folder. RelayStore =
// sealed blobs on a zero-knowledge Cloudflare Worker, authorized by the verifier.
import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function localStore(dir) {
  if (!dir) throw new Error('HOUSEHOLD_DIR is not set (local storage mode)');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = memberId => join(dir, `${memberId}.json`);
  return {
    async push(memberId, bytes) {
      writeFileSync(file(memberId), bytes);
    },
    async pullAll() {
      return readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => ({
          memberId: f.replace(/\.json$/, ''),
          bytes: readFileSync(join(dir, f), 'utf8'),
          updatedAt: statSync(join(dir, f)).mtime.toISOString(),
        }));
    },
    async remove(memberId) {
      if (existsSync(file(memberId))) unlinkSync(file(memberId));
    },
  };
}

function relayStore({ relayUrl, householdId, verifier }) {
  if (!relayUrl || !householdId || !verifier) throw new Error('relay store needs relayUrl, householdId, verifier');
  const base = relayUrl.replace(/\/$/, '');
  const auth = { Authorization: verifier };
  return {
    async push(memberId, bytes) {
      const res = await fetch(`${base}/rooms/${householdId}/members/${memberId}`, {
        method: 'PUT',
        headers: auth,
        body: bytes,
      });
      if (!res.ok) throw new Error(`relay push failed: ${res.status}`);
    },
    async pullAll() {
      const res = await fetch(`${base}/rooms/${householdId}`, { headers: auth });
      if (!res.ok) throw new Error(`relay pull failed: ${res.status}`);
      const { members = [] } = await res.json();
      return members.map(m => ({ memberId: m.memberId, bytes: m.blob, updatedAt: m.updatedAt }));
    },
    async remove(memberId) {
      const res = await fetch(`${base}/rooms/${householdId}/members/${memberId}`, { method: 'DELETE', headers: auth });
      if (!res.ok) throw new Error(`relay remove failed: ${res.status}`);
    },
  };
}

export function makeStore(cfg) {
  return cfg.storage === 'relay' ? relayStore(cfg) : localStore(cfg.dir);
}

export async function createRoom(cfg) {
  if (cfg.storage !== 'relay') return;
  const res = await fetch(`${cfg.relayUrl.replace(/\/$/, '')}/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ household_id: cfg.householdId, verifier: cfg.verifier }),
  });
  if (!res.ok) throw new Error(`relay createRoom failed: ${res.status}`);
}
