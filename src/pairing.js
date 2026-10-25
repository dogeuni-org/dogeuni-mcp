import { createHash, randomBytes } from 'node:crypto';

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes as unpadded base64url (43 chars). */
export function generateToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * Pairing code (protocol §Pairing): first 4 bytes of
 * SHA-256(UTF-8 "dogeuni-agent-pair:" + token), read big-endian as uint32,
 * mod 10^6, zero-padded to 6 digits.
 * @param {string} token
 */
export function pairingCode(token) {
  const digest = createHash('sha256').update(`dogeuni-agent-pair:${token}`, 'utf8').digest();
  return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

/** What the extension stores: SHA-256(UTF-8 token) as lowercase hex. */
export function tokenHash(token) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Agent name: 1–40 characters (Unicode code points) after trimming, no control characters.
 * @param {string} name
 * @returns {string | null} the normalized name, or null if invalid
 */
export function normalizeName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  const len = [...n].length;
  if (len < 1 || len > 40) return null;
  if (/[\p{Cc}]/u.test(n)) return null;
  return n;
}
