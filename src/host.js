// Native messaging host `com.dogeuni.agent`: bridges the unix socket
// (MCP side, newline-delimited JSON) and Chrome (extension side, native
// messaging frames on stdin/stdout). It only forwards and checks the basic
// shape of messages; all authentication happens in the extension.
// Protocol: docs/protocol.md.

import fs from 'node:fs';
import net from 'node:net';
import { MessageDecoder, encodeMessage } from './framing.js';
import { LineSplitter, isId, isPlainObject } from './lines.js';
import { dogeuniHome, ensureHomeDir, socketPath } from './paths.js';
import { VERSION } from './version.js';

const BAD_REQUEST_LINE = JSON.stringify({ id: null, error: { code: 'BAD_REQUEST' } }) + '\n';

const log = (msg) => process.stderr.write(`dogeuni-mcp host: ${msg}\n`);

/**
 * Probe an existing socket file. Resolves 'live' if something accepts the
 * connection, 'stale' if the connection is refused.
 * @param {string} p
 * @returns {Promise<'live' | 'stale'>}
 */
function probeSocket(p) {
  return new Promise((resolve, reject) => {
    const s = net.connect(p);
    const timer = setTimeout(() => {
      s.destroy();
      resolve('live'); // something holds it but is slow; never delete it
    }, 1000);
    s.once('connect', () => {
      clearTimeout(timer);
      s.destroy();
      resolve('live');
    });
    s.once('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') resolve('stale');
      else reject(err);
    });
  });
}

/** @param {string} p */
function listen(p) {
  return new Promise((resolve, reject) => {
    const server = net.createServer({ allowHalfOpen: false });
    const old = process.umask(0o177); // socket is created 0600 from the start
    server.once('error', (err) => {
      process.umask(old);
      reject(err);
    });
    server.listen(p, () => {
      process.umask(old);
      resolve(server);
    });
  });
}

/**
 * Run the host until stdin closes. Exits the process.
 * @param {{ home?: string }} [opts]
 */
export async function runHost({ home = dogeuniHome() } = {}) {
  const sock = socketPath(home);
  try {
    ensureHomeDir(home);
    let st = null;
    try {
      st = fs.lstatSync(sock);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (st) {
      if (!st.isSocket()) throw new Error(`${sock} exists and is not a socket; refusing to replace it`);
      if ((await probeSocket(sock)) === 'live') {
        log('another host is already listening; exiting');
        process.exit(1);
      }
      fs.unlinkSync(sock);
    }
  } catch (err) {
    log(`startup failed: ${err.message}`);
    process.exit(1);
  }

  let server;
  try {
    server = await listen(sock);
    fs.chmodSync(sock, 0o600);
  } catch (err) {
    log(err.code === 'EADDRINUSE' ? 'another host is already listening; exiting' : `listen failed: ${err.message}`);
    process.exit(1);
  }
  const ourIno = fs.statSync(sock).ino;

  /** @type {Map<number, { socket: net.Socket, used: boolean, dead: boolean }>} */
  const conns = new Map();
  let nextConn = 1;
  let shuttingDown = false;

  const shutdown = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      if (fs.statSync(sock).ino === ourIno) fs.unlinkSync(sock);
    } catch {
      /* already gone */
    }
    for (const c of conns.values()) c.socket.destroy();
    server.close();
    process.exit(code);
  };

  const toChrome = (msg) => {
    if (shuttingDown) return false;
    let frame;
    try {
      frame = encodeMessage(msg);
    } catch {
      return false;
    }
    process.stdout.write(frame);
    return true;
  };

  // Before any call: nothing has run since the listen resolved, so no connection is handled yet. The wallet
  // only displays the version.
  toChrome({ v: 1, type: 'hello', version: VERSION });

  server.on('connection', (socket) => {
    if (shuttingDown) return socket.destroy();
    const conn = nextConn++;
    const state = { socket, used: false, dead: false };
    conns.set(conn, state);

    const badRequest = () => {
      if (state.dead) return;
      state.dead = true;
      splitter.stop();
      socket.end(BAD_REQUEST_LINE);
      // Do not wait forever for a client that never reads.
      setTimeout(() => socket.destroy(), 1000).unref();
    };

    const splitter = new LineSplitter({
      onOverflow: badRequest,
      onLine: (line) => {
        if (state.dead || line.trim() === '') return;
        let req;
        try {
          req = JSON.parse(line);
        } catch {
          return badRequest();
        }
        if (!isPlainObject(req) || !isId(req.id)) return badRequest();
        const call = { v: 1, type: 'call', conn, id: req.id, token: req.token, method: req.method, params: req.params };
        if (!toChrome(call)) return badRequest();
        state.used = true;
      },
    });

    socket.on('data', (chunk) => splitter.push(chunk));
    socket.on('error', () => {});
    socket.on('close', () => {
      conns.delete(conn);
      if (state.used) toChrome({ v: 1, type: 'closed', conn });
    });
  });

  const decoder = new MessageDecoder({
    onInvalid: (reason) => log(`dropped message from extension: ${reason}`),
    onMessage: (msg) => {
      const reply = toSocketReply(msg);
      if (!reply) return log('dropped malformed message from extension');
      const c = conns.get(reply.conn);
      if (!c || c.dead) return; // connection already gone
      c.socket.write(JSON.stringify(reply.line) + '\n');
    },
  });

  process.stdin.on('data', (chunk) => decoder.push(chunk));
  process.stdin.on('end', () => shutdown(0));
  process.stdin.on('close', () => shutdown(0));
  process.stdin.on('error', () => shutdown(0));
  process.stdout.on('error', () => shutdown(0));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => shutdown(0));
}

/**
 * Validate an extension -> host message and turn it into a socket reply.
 * @param {unknown} msg
 * @returns {{ conn: number, line: object } | null}
 */
export function toSocketReply(msg) {
  if (!isPlainObject(msg) || msg.v !== 1 || !isId(msg.conn) || !isId(msg.id)) return null;
  if (msg.type === 'result') {
    if (!('result' in msg) || msg.result === undefined) return null;
    return { conn: msg.conn, line: { id: msg.id, result: msg.result } };
  }
  if (msg.type === 'error') {
    const e = msg.error;
    if (!isPlainObject(e) || typeof e.code !== 'string' || e.code === '') return null;
    if (e.message !== undefined && typeof e.message !== 'string') return null;
    const error = e.message === undefined ? { code: e.code } : { code: e.code, message: e.message };
    return { conn: msg.conn, line: { id: msg.id, error } };
  }
  return null;
}
