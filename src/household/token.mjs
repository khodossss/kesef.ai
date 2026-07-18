// Family token: kesef1.<householdId>.<secret>. The secret is key material and
// NEVER leaves the owner's machine (see crypto.mjs). base64url has no '.', so the
// dot separator is unambiguous.
import { randomBytes } from 'node:crypto';

const PREFIX = 'kesef1';

export function newHouseholdId() {
  return randomBytes(16).toString('base64url');
}

export function newSecret() {
  return randomBytes(32).toString('base64url');
}

export function formatToken({ householdId, secret }) {
  return `${PREFIX}.${householdId}.${secret}`;
}

export function parseToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) {
    throw new Error('invalid token');
  }
  return { householdId: parts[1], secret: parts[2] };
}
