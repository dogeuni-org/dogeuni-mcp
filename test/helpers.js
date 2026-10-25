import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MessageDecoder, encodeMessage } from '../src/framing.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOST_BIN = path.join(ROOT, 'bin', 'host.js');
export const CLI_BIN = path.join(ROOT, 'bin', 'cli.js');

/** Fresh temp dir standing in for ~/.dogeuni (never the real one). */
export function tmpHome() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dmcp-'));
  return { base, home: path.join(base, 'home') };
}

export const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Async queue with predicate-based waiting. */
export class Inbox {
  constructor() {
    this.items = [];
    this.waiters = [];
  }
  push(item) {
    this.items.push(item);
    for (const w of [...this.waiters]) w();
  }
  /** @returns {Promise<any>} */
  next(pred = () => true, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const i = this.items.findIndex(pred);
        if (i === -1) return false;
        const [item] = this.items.splice(i, 1);
        cleanup();
        resolve(item);
        return true;
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timed out waiting; have ${JSON.stringify(this.items)}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== check);
      };
      if (!check()) this.waiters.push(check);
    });
  }
}

export async function waitFor(fn, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await delay(20);
  }
}

export const canConnect = (p) =>
  new Promise((resolve) => {
    const s = net.connect(p);
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });

/**
 * Spawn the host the way Chrome would, with a fake "Chrome" on its stdio.
 * @param {string} home
 * @param {{ wait?: boolean, cmd?: string[] }} [opts]
 */
export async function startHost(home, { wait = true, cmd = [process.execPath, HOST_BIN] } = {}) {
  const child = spawn(cmd[0], [...cmd.slice(1), 'chrome-extension://mfdcchljfhgjjpmlnplfdeianllkempb/'], {
    env: { ...process.env, DOGEUNI_HOME: home },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const fromHost = new Inbox();
  const decoder = new MessageDecoder({ onMessage: (m) => fromHost.push(m), onInvalid: (r) => fromHost.push({ invalid: r }) });
  child.stdout.on('data', (c) => decoder.push(c));
  let stderr = '';
  child.stderr.on('data', (c) => (stderr += c));
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const host = {
    child,
    fromHost,
    exited,
    get stderr() {
      return stderr;
    },
    send: (msg) => child.stdin.write(encodeMessage(msg)),
    sendRaw: (buf) => child.stdin.write(buf),
    stop: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.stdin.end();
        const t = setTimeout(() => child.kill('SIGKILL'), 2000);
        await exited;
        clearTimeout(t);
      }
    },
  };
  if (wait) {
    const sock = path.join(home, 'agent.sock');
    await Promise.race([
      waitFor(() => canConnect(sock)),
      exited.then((e) => {
        throw new Error(`host exited early ${JSON.stringify(e)}: ${stderr}`);
      }),
    ]);
  }
  return host;
}

/** A socket client (stands in for the MCP server) reading reply lines. */
export function connectClient(sockPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(sockPath);
    const lines = new Inbox();
    let buf = '';
    const closed = new Promise((r) => socket.on('close', r));
    socket.on('data', (c) => {
      buf += c.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        lines.push(JSON.parse(buf.slice(0, nl)));
        buf = buf.slice(nl + 1);
      }
    });
    socket.once('error', reject);
    socket.once('connect', () =>
      resolve({
        socket,
        lines,
        closed,
        send: (obj) => socket.write((typeof obj === 'string' ? obj : JSON.stringify(obj)) + '\n'),
        close: () => socket.end(),
      }),
    );
  });
}

/**
 * Fake host peer on the socket: `handler(req)` returns the reply object (without id)
 * or undefined for no reply.
 */
export function fakeSocketPeer(sockPath, handler) {
  const requests = [];
  const server = net.createServer((s) => {
    let buf = '';
    s.on('data', async (c) => {
      buf += c;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const req = JSON.parse(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        requests.push(req);
        const reply = await handler(req);
        if (reply !== undefined) s.write(JSON.stringify({ id: req.id, ...reply }) + '\n');
      }
    });
    s.on('error', () => {});
  });
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(sockPath), { recursive: true, mode: 0o700 });
    server.listen(sockPath, () => resolve({ server, requests, close: () => new Promise((r) => server.close(r)) }));
  });
}

/** Leave a socket file behind with nothing listening (a crashed host). */
export async function makeStaleSocket(sockPath) {
  fs.mkdirSync(path.dirname(sockPath), { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, [
    '-e',
    `require('net').createServer().listen(${JSON.stringify(sockPath)}, () => process.kill(process.pid, 'SIGKILL'))`,
  ]);
  await new Promise((r) => child.on('exit', r));
  if (!fs.lstatSync(sockPath).isSocket()) throw new Error('stale socket not created');
}
