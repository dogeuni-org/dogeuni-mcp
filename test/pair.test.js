import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { MSG_NOT_RUNNING } from '../src/messages.js';
import { TOKEN_RE, pairingCode } from '../src/pairing.js';
import { CLI_BIN, fakeSocketPeer, tmpHome } from './helpers.js';

const cleanup = [];
after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

function runCli(home, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], { env: { ...process.env, DOGEUNI_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}

function setup() {
  const { base, home } = tmpHome();
  cleanup.push(() => fs.rmSync(base, { recursive: true, force: true }));
  return { home, sock: path.join(home, 'agent.sock') };
}

test('pair: prints the code, sends pair.request, saves credentials 0600', async () => {
  const { home, sock } = setup();
  let seenCode;
  const peer = await fakeSocketPeer(sock, (req) => {
    seenCode = pairingCode(req.params.token);
    return { result: { agentId: 'agent-42' } };
  });
  cleanup.push(() => peer.close());

  const r = await runCli(home, ['pair', '--name', 'Claude Code']);
  assert.equal(r.code, 0, r.stderr);
  const [req] = peer.requests;
  assert.equal(req.method, 'pair.request');
  assert.equal('token' in req, false); // only pair.request goes without a top-level token
  assert.equal(req.params.name, 'Claude Code');
  assert.match(req.params.token, TOKEN_RE);
  assert.ok(r.stdout.includes(`Pairing code: ${seenCode}\n`));

  const file = path.join(home, 'credentials.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(home).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { agentId: 'agent-42', name: 'Claude Code', token: req.params.token });
});

test('pair: DENIED / BUSY leave no credentials', async () => {
  for (const [code, re] of [
    ['DENIED', /declined/],
    ['BUSY', /already waiting/],
    ['TIMEOUT', /5 minutes/],
  ]) {
    const { home, sock } = setup();
    const peer = await fakeSocketPeer(sock, () => ({ error: { code } }));
    const r = await runCli(home, ['pair']);
    await peer.close();
    assert.equal(r.code, 1);
    assert.match(r.stderr, re);
    assert.equal(fs.existsSync(path.join(home, 'credentials.json')), false);
  }
});

test('pair: no host running', async () => {
  const { home } = setup();
  const r = await runCli(home, ['pair']);
  assert.equal(r.code, 1);
  assert.ok(r.stderr.includes(MSG_NOT_RUNNING), r.stderr);
});

test('pair: invalid --name is refused before contacting the wallet', async () => {
  const { home } = setup();
  const r = await runCli(home, ['pair', '--name', 'x'.repeat(41)]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /1–40 characters/);
});
