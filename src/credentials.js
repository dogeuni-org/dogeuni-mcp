import fs from 'node:fs';
import path from 'node:path';
import { TOKEN_RE } from './pairing.js';
import { credentialsPath, ensureHomeDir } from './paths.js';

/**
 * @typedef {{ agentId: string, name: string, token: string }} Credentials
 */

export class InvalidCredentialsError extends Error {}

/**
 * @param {string} home
 * @returns {Credentials | null} null if the file does not exist
 */
export function readCredentials(home) {
  let raw;
  try {
    raw = fs.readFileSync(credentialsPath(home), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let c;
  try {
    c = JSON.parse(raw);
  } catch {
    throw new InvalidCredentialsError('credentials.json is not valid JSON');
  }
  if (!c || typeof c.token !== 'string' || !TOKEN_RE.test(c.token) || typeof c.agentId !== 'string' || typeof c.name !== 'string') {
    throw new InvalidCredentialsError('credentials.json is missing agentId, name or a valid token');
  }
  return { agentId: c.agentId, name: c.name, token: c.token };
}

/**
 * Atomically write credentials.json with mode 0600.
 * @param {string} home
 * @param {Credentials} creds
 */
export function writeCredentials(home, { agentId, name, token }) {
  ensureHomeDir(home);
  const dest = credentialsPath(home);
  const tmp = path.join(home, `.credentials.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, JSON.stringify({ agentId, name, token }, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, dest);
}
