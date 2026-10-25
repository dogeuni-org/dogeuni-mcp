// One request per connection to the host's unix socket.

import net from 'node:net';
import { LineSplitter, isPlainObject } from './lines.js';

/** Responses come from Chrome frames (≤ 1 MiB), so a reply line is never longer. */
const MAX_REPLY_LINE = 1024 * 1024 + 1024;

/** The host is not running (no agent session in the wallet). */
export class WalletUnavailableError extends Error {}
export class WalletTimeoutError extends Error {}
export class WalletProtocolError extends Error {}

/**
 * @param {string} sockPath
 * @param {{ id?: number, token?: string, method: string, params?: object }} req
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ result: unknown } | { error: { code: string, message?: string } }>}
 */
export function callWallet(sockPath, req, { timeoutMs = 30_000 } = {}) {
  const id = req.id ?? 1;
  const line = JSON.stringify({ id, token: req.token, method: req.method, params: req.params ?? {} }) + '\n';
  return new Promise((resolve, reject) => {
    let settled = false;
    let connected = false;
    const socket = net.connect(sockPath);
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new WalletTimeoutError('wallet did not answer in time')), timeoutMs);

    const splitter = new LineSplitter({
      maxLine: MAX_REPLY_LINE,
      onOverflow: () => finish(reject, new WalletProtocolError('reply too long')),
      onLine: (text) => {
        let msg;
        try {
          msg = JSON.parse(text);
        } catch {
          return finish(reject, new WalletProtocolError('reply is not JSON'));
        }
        if (!isPlainObject(msg)) return finish(reject, new WalletProtocolError('reply is not an object'));
        if (msg.id === null && isPlainObject(msg.error)) return finish(resolve, { error: normalizeError(msg.error) });
        if (msg.id !== id) return; // not ours
        if (isPlainObject(msg.error)) return finish(resolve, { error: normalizeError(msg.error) });
        if ('result' in msg) return finish(resolve, { result: msg.result });
        finish(reject, new WalletProtocolError('reply has neither result nor error'));
      },
    });

    socket.on('connect', () => {
      connected = true;
      socket.write(line);
    });
    socket.on('data', (chunk) => splitter.push(chunk));
    socket.on('error', (err) => {
      if (!connected && (err.code === 'ENOENT' || err.code === 'ECONNREFUSED' || err.code === 'ENOTSOCK')) {
        finish(reject, new WalletUnavailableError('agent session not running'));
      } else {
        finish(reject, new WalletUnavailableError(`socket error: ${err.code ?? err.message}`));
      }
    });
    socket.on('close', () => finish(reject, new WalletUnavailableError('connection closed before a reply')));
  });
}

function normalizeError(e) {
  return {
    code: typeof e.code === 'string' ? e.code : 'INTERNAL',
    ...(typeof e.message === 'string' ? { message: e.message } : {}),
  };
}
