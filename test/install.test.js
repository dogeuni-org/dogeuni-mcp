import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { hostEntryPath, install, launcherScript, uninstall } from '../src/install.js';
import { CLI_BIN, startHost, tmpHome } from './helpers.js';

const cleanup = [];
after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});
function dirs() {
  const t = tmpHome();
  cleanup.push(() => fs.rmSync(t.base, { recursive: true, force: true }));
  return { home: t.home, hostsDir: path.join(t.base, 'NativeMessagingHosts') };
}

test('install writes the manifest and a 0755 launcher (via the CLI)', () => {
  const { home, hostsDir } = dirs();
  const out = execFileSync(process.execPath, [CLI_BIN, 'install', '--hosts-dir', hostsDir], {
    env: { ...process.env, DOGEUNI_HOME: home },
    encoding: 'utf8',
  });
  assert.match(out, /com\.dogeuni\.agent\.json/);

  const launcher = path.join(home, 'host');
  const manifest = JSON.parse(fs.readFileSync(path.join(hostsDir, 'com.dogeuni.agent.json'), 'utf8'));
  assert.deepEqual(manifest, {
    name: 'com.dogeuni.agent',
    description: 'DogeUni wallet agent bridge (dogeuni-mcp)',
    path: launcher,
    type: 'stdio',
    allowed_origins: ['chrome-extension://mfdcchljfhgjjpmlnplfdeianllkempb/'],
  });
  assert.ok(path.isAbsolute(manifest.path));

  assert.equal(fs.statSync(launcher).mode & 0o777, 0o755);
  assert.equal(fs.statSync(home).mode & 0o777, 0o700);
  const script = fs.readFileSync(launcher, 'utf8');
  assert.ok(script.startsWith('#!/bin/sh\n'));
  assert.ok(script.includes(`exec "${process.execPath}" "${hostEntryPath()}"\n`));
});

test('--extension-id is used; invalid ids are refused', () => {
  const { home, hostsDir } = dirs();
  const id = 'abcdefghijklmnopabcdefghijklmnop';
  install({ home, hostsDir, extensionId: id });
  const manifest = JSON.parse(fs.readFileSync(path.join(hostsDir, 'com.dogeuni.agent.json'), 'utf8'));
  assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${id}/`]);
  assert.throws(() => install({ home, hostsDir, extensionId: 'zzzz' }), /Invalid extension id/);
  assert.throws(() => install({ home, hostsDir, extensionId: `chrome-extension://${id}/` }), /Invalid extension id/);
});

test('unsupported platforms are refused', () => {
  const { home, hostsDir } = dirs();
  assert.throws(() => install({ home, hostsDir, platform: 'win32' }), /macOS and Linux only/);
  assert.equal(fs.existsSync(hostsDir), false);
});

test('the launcher really starts the host (Chrome-style, with an origin argument)', async () => {
  const { home, hostsDir } = dirs();
  const { launcher } = install({ home, hostsDir });
  const host = await startHost(home, { cmd: [launcher] });
  assert.ok(fs.existsSync(path.join(home, 'agent.sock')));
  host.child.stdin.end();
  assert.equal((await host.exited).code, 0);
});

test('launcher quoting survives spaces, $, quotes and backticks', () => {
  const { home } = dirs();
  fs.mkdirSync(home, { recursive: true });
  const weird = '/tmp/a b/$HOME "q" `x` \\z';
  const script = path.join(home, 'echo.sh');
  fs.writeFileSync(script, launcherScript('/bin/echo', weird), { mode: 0o755 });
  const r = spawnSync(script, [], { encoding: 'utf8' });
  assert.equal(r.stdout, `${weird}\n`);
});

test('uninstall removes the manifest and launcher, keeps credentials', () => {
  const { home, hostsDir } = dirs();
  install({ home, hostsDir });
  fs.writeFileSync(path.join(home, 'credentials.json'), '{}', { mode: 0o600 });
  const out = execFileSync(process.execPath, [CLI_BIN, 'uninstall', '--hosts-dir', hostsDir], {
    env: { ...process.env, DOGEUNI_HOME: home },
    encoding: 'utf8',
  });
  assert.match(out, /Removed/);
  assert.equal(fs.existsSync(path.join(hostsDir, 'com.dogeuni.agent.json')), false);
  assert.equal(fs.existsSync(path.join(home, 'host')), false);
  assert.ok(fs.existsSync(path.join(home, 'credentials.json')));
  assert.deepEqual(uninstall({ home, hostsDir }), []);
});
