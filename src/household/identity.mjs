// Household identity + config, read from / written to the repo-root .env.
// Uses a RAW env parse (no un-commenting) so a commented key is inactive — unlike
// config.loadEnv, which un-comments for the Docker toggle.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { envPath, DEFAULT_RELAY_URL } from '../../config.mjs';

export function readEnvRaw() {
  const path = envPath();
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); // no leading '#': commented = inactive
    if (m && m[2] !== '') out[m[1]] = m[2];
  }
  return out;
}

export function writeEnvKeys(patch) {
  const path = envPath();
  const lines = existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/) : [];
  for (const [key, value] of Object.entries(patch)) {
    const idx = lines.findIndex(l => new RegExp(`^#?\\s*${key}=`).test(l));
    const rendered = value === null ? null : `${key}=${value}`;
    if (idx >= 0) {
      if (rendered === null) lines.splice(idx, 1);
      else lines[idx] = rendered;
    } else if (rendered !== null) {
      lines.push(rendered);
    }
  }
  writeFileSync(path, lines.join('\n'));
}

export function newMemberId() {
  return 'm_' + randomBytes(6).toString('base64url').slice(0, 8);
}

export function loadHousehold() {
  const env = readEnvRaw();
  if (!env.HOUSEHOLD_STORAGE) return null;
  return {
    storage: env.HOUSEHOLD_STORAGE,
    dir: env.HOUSEHOLD_DIR || null,
    token: env.HOUSEHOLD_TOKEN || null,
    relayUrl: env.RELAY_URL || DEFAULT_RELAY_URL,
    member: { id: env.MEMBER_ID || null, info: env.MEMBER_INFO || '' },
  };
}

export function displayName(member, index) {
  return member && member.info ? member.info : `Юзер ${index + 1}`;
}
