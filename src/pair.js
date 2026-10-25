import { readCredentials, writeCredentials } from './credentials.js';
import { generateToken, normalizeName, pairingCode } from './pairing.js';
import { credentialsPath, dogeuniHome, socketPath } from './paths.js';
import { WalletTimeoutError, WalletUnavailableError, callWallet } from './socketClient.js';
import { MSG_NOT_RUNNING } from './messages.js';

/** The wallet answers TIMEOUT after 5 minutes; wait a little longer so its answer arrives first. */
const PAIR_WAIT_MS = 5 * 60 * 1000 + 15_000;
const AGENT_ID_MAX = 128;

const ERRORS = {
  BUSY: 'Another pairing is already waiting for confirmation in the wallet. Finish or cancel it, then try again.',
  DENIED: 'Pairing was declined in the wallet.',
  TIMEOUT: 'Pairing was not confirmed within 5 minutes.',
};

/**
 * @param {{ name?: string, home?: string, out?: (s: string) => void, waitMs?: number }} opts
 * @returns {Promise<number>} exit code
 */
export async function runPair({ name = 'dogeuni-mcp', home = dogeuniHome(), out = (s) => process.stdout.write(s), waitMs = PAIR_WAIT_MS } = {}) {
  const err = (s) => process.stderr.write(`${s}\n`);
  const agentName = normalizeName(name);
  if (!agentName) {
    err('--name must be 1–40 characters with no control characters.');
    return 2;
  }

  let previous = null;
  try {
    previous = readCredentials(home);
  } catch {
    /* unreadable credentials are replaced on success */
  }

  const token = generateToken();
  const code = pairingCode(token);
  out(`Pairing code: ${code}\n`);
  out(`In the DogeUni wallet, check that the confirmation window shows agent "${agentName}" and code ${code}, then enter your password to approve.\n`);
  out('Waiting for confirmation (up to 5 minutes)...\n');

  let reply;
  try {
    reply = await callWallet(socketPath(home), { method: 'pair.request', params: { name: agentName, token } }, { timeoutMs: waitMs });
  } catch (e) {
    if (e instanceof WalletUnavailableError) err(MSG_NOT_RUNNING);
    else if (e instanceof WalletTimeoutError) err(ERRORS.TIMEOUT);
    else err('The wallet sent an unexpected reply.');
    return 1;
  }
  if ('error' in reply) {
    err(ERRORS[reply.error.code] ?? `Pairing failed: ${/^[A-Z_]{1,32}$/.test(reply.error.code) ? reply.error.code : 'INTERNAL'}.`);
    return 1;
  }
  const agentId = reply.result?.agentId;
  if (typeof agentId !== 'string' || agentId.length === 0 || agentId.length > AGENT_ID_MAX) {
    err('The wallet sent an unexpected reply.');
    return 1;
  }

  writeCredentials(home, { agentId, name: agentName, token });
  out(`Paired as agent ${agentId}. Token saved to ${credentialsPath(home)} (mode 0600).\n`);
  if (previous && previous.agentId !== agentId) {
    out(`The previous pairing (${previous.agentId}) is no longer used here; revoke it in the wallet.\n`);
  }
  return 0;
}
