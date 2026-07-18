// Family operations orchestrating identity + transport + crypto + merge.
// The *With(cfg, makeSnapshot) variants are pure of .env/DB for testing; the
// public ops load config from .env and build the snapshot from the local store.
import { exportSnapshot } from '../store.mjs';
import { parseToken, newHouseholdId, newSecret, formatToken } from './token.mjs';
import { deriveKey, deriveVerifier, seal, open } from './crypto.mjs';
import { makeStore, createRoom } from './stores.mjs';
import { mergeSnapshots, householdAccounts, householdTransactions, householdReconcile } from './merge.mjs';
import { loadHousehold, writeEnvKeys, newMemberId, displayName, readEnvRaw } from './identity.mjs';
import { DEFAULT_RELAY_URL } from '../../config.mjs';

// --- relay key material from a cfg that carries a token ---
function relayKeys(cfg) {
  const { householdId, secret } = parseToken(cfg.token);
  return { householdId, key: deriveKey(secret, householdId), verifier: deriveVerifier(secret) };
}

function storeFor(cfg) {
  if (cfg.storage === 'relay') {
    const { householdId, verifier } = relayKeys(cfg);
    return { store: makeStore({ storage: 'relay', relayUrl: cfg.relayUrl, householdId, verifier }), seal: true };
  }
  return { store: makeStore({ storage: 'local', dir: cfg.dir }), seal: false };
}

// --- testable core ---
export async function syncWith(cfg, makeSnapshot) {
  const { store, seal: doSeal } = storeFor(cfg);
  const snap = makeSnapshot();
  const json = JSON.stringify(snap);
  const bytes = doSeal ? seal(relayKeys(cfg).key, json) : json;
  await store.push(cfg.member.id, bytes);
  let pulled = 0;
  const others = await store.pullAll().catch(() => []);
  pulled = others.length;
  return { ok: true, pushed: cfg.member.id, pulled };
}

export async function pullSnapshotsWith(cfg, makeSnapshot) {
  const { store, seal: doSeal } = storeFor(cfg);
  const raw = await store.pullAll().catch(() => []);
  const decoded = [];
  const key = cfg.storage === 'relay' ? relayKeys(cfg).key : null;
  for (const r of raw) {
    try {
      decoded.push(JSON.parse(doSeal ? open(key, r.bytes) : r.bytes));
    } catch {
      /* skip a corrupt/foreign blob rather than fail the whole report */
    }
  }
  // own snapshot always fresh from the local DB, wins on id
  decoded.push(makeSnapshot());
  return mergeSnapshots(decoded);
}

// --- public ops (load .env + local DB) ---
function requireHousehold() {
  const cfg = loadHousehold();
  if (!cfg || !cfg.member.id) throw new Error('family mode not set up — run family_create or family_join first');
  return cfg;
}

const snapshotThunk = cfg => () => exportSnapshot(cfg.member);

export async function familyCreate({ mode = 'relay', info = '', dir = null } = {}) {
  const id = newMemberId();
  if (mode === 'relay') {
    const token = formatToken({ householdId: newHouseholdId(), secret: newSecret() });
    const { householdId, verifier } = relayKeys({ token });
    const relayUrl = readEnvRaw().RELAY_URL || DEFAULT_RELAY_URL;
    await createRoom({ storage: 'relay', relayUrl, householdId, verifier });
    writeEnvKeys({
      HOUSEHOLD_STORAGE: 'relay',
      HOUSEHOLD_TOKEN: token,
      HOUSEHOLD_DIR: null,
      MEMBER_ID: id,
      MEMBER_INFO: info,
    });
    return { ok: true, mode, token, member: { id, info } };
  }
  if (!dir) throw new Error('local mode needs a dir');
  writeEnvKeys({
    HOUSEHOLD_STORAGE: 'local',
    HOUSEHOLD_DIR: dir,
    HOUSEHOLD_TOKEN: null,
    MEMBER_ID: id,
    MEMBER_INFO: info,
  });
  return { ok: true, mode, member: { id, info } };
}

export async function familyJoin({ token = null, dir = null, info = '' } = {}) {
  const id = newMemberId();
  let cfg;
  if (token) {
    parseToken(token); // validate format
    cfg = { storage: 'relay', token, relayUrl: readEnvRaw().RELAY_URL || DEFAULT_RELAY_URL, member: { id, info } };
  } else if (dir) {
    cfg = { storage: 'local', dir, member: { id, info } };
  } else {
    throw new Error('family_join needs a token (relay) or dir (local)');
  }
  // reachability check — pull directly so a bad token / unreachable relay throws (pullSnapshotsWith swallows errors)
  const { store } = storeFor(cfg);
  await store.pullAll();
  // persist only after a successful reach; null the other mode's key to avoid stale state
  if (token) {
    writeEnvKeys({
      HOUSEHOLD_STORAGE: 'relay',
      HOUSEHOLD_TOKEN: token,
      HOUSEHOLD_DIR: null,
      MEMBER_ID: id,
      MEMBER_INFO: info,
    });
  } else {
    writeEnvKeys({
      HOUSEHOLD_STORAGE: 'local',
      HOUSEHOLD_DIR: dir,
      HOUSEHOLD_TOKEN: null,
      MEMBER_ID: id,
      MEMBER_INFO: info,
    });
  }
  return { ok: true, mode: cfg.storage, member: { id, info } };
}

export async function familyLeave() {
  const cfg = requireHousehold();
  const { store } = storeFor(cfg);
  await store.remove(cfg.member.id).catch(() => {});
  writeEnvKeys({
    HOUSEHOLD_STORAGE: null,
    HOUSEHOLD_DIR: null,
    HOUSEHOLD_TOKEN: null,
    MEMBER_ID: null,
    MEMBER_INFO: null,
  });
  return { ok: true };
}

export async function familyStatus({ setInfo } = {}) {
  if (setInfo !== undefined) writeEnvKeys({ MEMBER_INFO: setInfo });
  const cfg = requireHousehold();
  const snaps = await pullSnapshotsWith(cfg, snapshotThunk(cfg));
  const members = snaps.map((s, i) => ({
    id: s.member.id,
    name: displayName(s.member, i),
    last_refresh:
      (s.refreshes || [])
        .map(r => r.last_refresh)
        .sort()
        .pop() || null,
    self: s.member.id === cfg.member.id,
  }));
  return { mode: cfg.storage, member: cfg.member, members };
}

export async function familySync() {
  return syncWith(requireHousehold(), snapshotThunk(requireHousehold()));
}

export async function householdView({ from, to } = {}) {
  const cfg = requireHousehold();
  const snaps = await pullSnapshotsWith(cfg, snapshotThunk(cfg));
  return { accounts: householdAccounts(snaps), reconcile: householdReconcile(snaps, { from, to }) };
}

export async function householdTxns(filters = {}) {
  const cfg = requireHousehold();
  const snaps = await pullSnapshotsWith(cfg, snapshotThunk(cfg));
  return householdTransactions(snaps, filters);
}
