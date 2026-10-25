import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { MAX_INBOUND } from '../src/framing.js';
import { canConnect, connectClient, makeStaleSocket, startHost, tmpHome } from './helpers.js';

const TOKEN = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const BAD = { id: null, error: { code: 'BAD_REQUEST' } };
const cleanup = [];
after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function setup({ preMode } = {}) {
  const { base, home } = tmpHome();
  if (preMode !== undefined) fs.mkdirSync(home, { mode: preMode });
  const host = await startHost(home);
  cleanup.push(() => host.stop(), () => fs.rmSync(base, { recursive: true, force: true }));
  return { home, sock: path.join(home, 'agent.sock'), host };
}

test('socket is 0600 and the directory is forced to 0700', async () => {
  const { home, sock } = await setup({ preMode: 0o755 });
  assert.equal(fs.statSync(home).mode & 0o777, 0o700);
  const st = fs.lstatSync(sock);
  assert.ok(st.isSocket());
  assert.equal(st.mode & 0o777, 0o600);
});

test('forwards calls with conn/id; pair.request goes without token', async () => {
  const { sock, host } = await setup();
  const c = await connectClient(sock);
  c.send({ id: 7, token: TOKEN, method: 'wallet.status', params: {} });
  const call = await host.fromHost.next();
  assert.deepEqual(call, { v: 1, type: 'call', conn: call.conn, id: 7, token: TOKEN, method: 'wallet.status', params: {} });
  assert.ok(Number.isSafeInteger(call.conn) && call.conn > 0);

  c.send({ id: 8, method: 'pair.request', params: { name: 'Claude Code', token: TOKEN } });
  const pair = await host.fromHost.next();
  assert.equal('token' in pair, false);
  assert.deepEqual(pair.params, { name: 'Claude Code', token: TOKEN });

  host.send({ v: 1, type: 'result', conn: call.conn, id: 7, result: { session: { expiresAt: 1 }, agent: { agentId: 'a1', name: 'n' } } });
  assert.deepEqual(await c.lines.next(), { id: 7, result: { session: { expiresAt: 1 }, agent: { agentId: 'a1', name: 'n' } } });
  host.send({ v: 1, type: 'error', conn: call.conn, id: 8, error: { code: 'DENIED', message: 'User declined' } });
  assert.deepEqual(await c.lines.next(), { id: 8, error: { code: 'DENIED', message: 'User declined' } });
  c.close();
});

test('routes replies by conn + id across two clients; closed sent on disconnect', async () => {
  const { sock, host } = await setup();
  const a = await connectClient(sock);
  const b = await connectClient(sock);
  a.send({ id: 1, token: TOKEN, method: 'account.get', params: {} });
  const ca = await host.fromHost.next((m) => m.type === 'call');
  b.send({ id: 1, token: TOKEN, method: 'account.get', params: {} });
  const cb = await host.fromHost.next((m) => m.type === 'call');
  assert.notEqual(ca.conn, cb.conn);

  // Reply to b first, then a; each gets only its own.
  host.send({ v: 1, type: 'result', conn: cb.conn, id: 1, result: { address: 'B' } });
  host.send({ v: 1, type: 'result', conn: ca.conn, id: 1, result: { address: 'A' } });
  assert.deepEqual(await b.lines.next(), { id: 1, result: { address: 'B' } });
  assert.deepEqual(await a.lines.next(), { id: 1, result: { address: 'A' } });
  assert.equal(a.lines.items.length + b.lines.items.length, 0);

  a.close();
  assert.deepEqual(await host.fromHost.next((m) => m.type === 'closed'), { v: 1, type: 'closed', conn: ca.conn });
  // b is unaffected
  b.send({ id: 2, token: TOKEN, method: 'account.balance', params: {} });
  const cb2 = await host.fromHost.next((m) => m.type === 'call');
  assert.equal(cb2.conn, cb.conn);
  host.send({ v: 1, type: 'result', conn: cb.conn, id: 2, result: { address: 'B', amount: '1.5' } });
  assert.deepEqual(await b.lines.next(), { id: 2, result: { address: 'B', amount: '1.5' } });
  b.close();
  await host.fromHost.next((m) => m.type === 'closed' && m.conn === cb.conn);
});

test('bad lines get BAD_REQUEST and the connection is closed', async () => {
  const { sock, host } = await setup();
  const bad = ['not json', '[1,2]', '"str"', 'null', '{"id":0}', '{"id":-1}', '{"id":1.5}', '{"id":"1"}', '{"method":"x"}', `{"id":${2 ** 53}}`];
  for (const line of bad) {
    const c = await connectClient(sock);
    c.send(line);
    assert.deepEqual(await c.lines.next(), BAD, line);
    await c.closed;
  }
  // None of them reached the extension.
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(host.fromHost.items.filter((m) => m.type === 'call').length, 0);
});

test('64 KiB line limit: exactly 65536 bytes forwarded, one more is BAD_REQUEST', async () => {
  const { sock, host } = await setup();
  const mk = (size) => {
    const base = JSON.stringify({ id: 1, method: 'm', params: { pad: '' } });
    return JSON.stringify({ id: 1, method: 'm', params: { pad: 'x'.repeat(size - base.length) } });
  };
  const ok = await connectClient(sock);
  const line = mk(64 * 1024);
  assert.equal(Buffer.byteLength(line), 65536);
  ok.send(line);
  const call = await host.fromHost.next((m) => m.type === 'call');
  assert.equal(call.params.pad.length, 65536 - JSON.stringify({ id: 1, method: 'm', params: { pad: '' } }).length);
  ok.close();

  const big = await connectClient(sock);
  big.send(mk(64 * 1024 + 1));
  assert.deepEqual(await big.lines.next(), BAD);
  await big.closed;

  // Oversized without any newline is cut off as soon as it passes the limit.
  const nonl = await connectClient(sock);
  nonl.socket.write('{"id":1,"p":"' + 'y'.repeat(70 * 1024));
  assert.deepEqual(await nonl.lines.next(), BAD);
  await nonl.closed;
});

test('earlier valid lines are forwarded; nothing after a bad line', async () => {
  const { sock, host } = await setup();
  const c = await connectClient(sock);
  c.socket.write('{"id":1,"method":"a"}\nnope\n{"id":2,"method":"b"}\n');
  assert.deepEqual(await c.lines.next(), BAD);
  await c.closed;
  const first = await host.fromHost.next((m) => m.type === 'call');
  assert.equal(first.id, 1);
  await host.fromHost.next((m) => m.type === 'closed' && m.conn === first.conn);
  assert.equal(host.fromHost.items.filter((m) => m.type === 'call').length, 0);
});

test('malformed extension messages are dropped; valid ones still route', async () => {
  const { sock, host } = await setup();
  const c = await connectClient(sock);
  c.send({ id: 1, token: TOKEN, method: 'account.get', params: {} });
  const { conn } = await host.fromHost.next((m) => m.type === 'call');

  const junkHeader = Buffer.alloc(4);
  junkHeader.writeUInt32LE(5, 0);
  host.sendRaw(Buffer.concat([junkHeader, Buffer.from('{nope')]));
  const huge = Buffer.alloc(4);
  huge.writeUInt32LE(MAX_INBOUND + 10, 0);
  host.sendRaw(Buffer.concat([huge, Buffer.alloc(MAX_INBOUND + 10, 0x20)]));
  for (const m of [
    { v: 2, type: 'result', conn, id: 1, result: 'wrong v' },
    { type: 'result', conn, id: 1, result: 'no v' },
    { v: 1, type: 'call', conn, id: 1, result: 'wrong type' },
    { v: 1, type: 'result', conn: 0, id: 1, result: 'bad conn' },
    { v: 1, type: 'result', conn, id: '1', result: 'bad id' },
    { v: 1, type: 'result', conn, id: 1 },
    { v: 1, type: 'error', conn, id: 1, error: 'string' },
    { v: 1, type: 'error', conn, id: 1, error: { message: 'no code' } },
    { v: 1, type: 'error', conn, id: 1, error: { code: 'X', message: 5 } },
    { v: 1, type: 'result', conn: conn + 1000, id: 1, result: 'unknown conn' },
    [1, 2, 3],
    'str',
  ]) {
    host.send(m);
  }
  host.send({ v: 1, type: 'result', conn, id: 1, result: { address: 'ok' } });
  assert.deepEqual(await c.lines.next(), { id: 1, result: { address: 'ok' } });
  assert.equal(c.lines.items.length, 0);
  assert.equal(host.child.exitCode, null);
  c.close();
});

test('stale socket file is removed and replaced', async () => {
  const { base, home } = tmpHome();
  const sock = path.join(home, 'agent.sock');
  await makeStaleSocket(sock);
  assert.equal(await canConnect(sock), false);
  const host = await startHost(home);
  cleanup.push(() => host.stop(), () => fs.rmSync(base, { recursive: true, force: true }));
  assert.equal(await canConnect(sock), true);
  assert.equal(fs.lstatSync(sock).mode & 0o777, 0o600);
});

test('a second host exits while the first keeps serving', async () => {
  const { home, sock, host } = await setup();
  const second = await startHost(home, { wait: false });
  const { code } = await second.exited;
  assert.notEqual(code, 0);
  assert.match(second.stderr, /another host/);
  assert.ok(fs.existsSync(sock));
  const c = await connectClient(sock);
  c.send({ id: 1, method: 'x' });
  await host.fromHost.next((m) => m.type === 'call');
  c.close();
});

test('refuses to replace a non-socket file', async () => {
  const { base, home } = tmpHome();
  cleanup.push(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.mkdirSync(home, { mode: 0o700 });
  const sock = path.join(home, 'agent.sock');
  fs.writeFileSync(sock, 'keep me');
  const host = await startHost(home, { wait: false });
  const { code } = await host.exited;
  assert.equal(code, 1);
  assert.equal(fs.readFileSync(sock, 'utf8'), 'keep me');
});

test('stdin EOF: socket removed, clients disconnected, exit 0', async () => {
  const { sock, host } = await setup();
  const c = await connectClient(sock);
  host.child.stdin.end();
  const { code } = await host.exited;
  assert.equal(code, 0);
  assert.equal(fs.existsSync(sock), false);
  await c.closed;
});
