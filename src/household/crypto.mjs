// E2E crypto for relay mode. The relay is zero-knowledge: it stores only the
// verifier (an HMAC of the secret) and ciphertext. The AES key is derived from
// the secret, which never leaves the machine — so the verifier cannot decrypt.
import { hkdfSync, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function deriveKey(secret, householdId) {
  const derived = hkdfSync('sha256', Buffer.from(secret), Buffer.from(householdId), Buffer.from('kesef-enc'), 32);
  return Buffer.from(derived);
}

export function deriveVerifier(secret) {
  return createHmac('sha256', Buffer.from(secret)).update('kesef-auth').digest('base64url');
}

export function seal(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({ v: 1, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: tag.toString('base64') });
}

export function open(key, blob) {
  const { iv, ct, tag } = JSON.parse(blob);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}
