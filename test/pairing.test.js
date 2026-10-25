import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TOKEN_RE, generateToken, normalizeName, pairingCode, tokenHash } from '../src/pairing.js';

// Shared with the extension: docs/protocol.md "Test vectors".
const VECTORS = [
  {
    bytes: Buffer.from([...Array(32).keys()]), // 0x00..0x1f
    token: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    code: '663428',
    hash: 'ea866a757e4c38babfa8127cbe9a409d3e1f93a00ff1488ff735fcf917afffd0',
  },
  {
    bytes: Buffer.alloc(32, 0x0c), // leading-zero case
    token: 'DAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw',
    code: '025930',
    hash: 'b0bc9af7f323ccf883996da7e3a0c52377b51337ed048f807d873f6e9cf46b27',
  },
  {
    bytes: Buffer.alloc(32, 0xff),
    token: '__________________________________________8',
    code: '227796',
    hash: '225f7e75329dd45aa354975d73987319309393af3a4c6733bc13601a4f1b8796',
  },
];

test('pairing code + token hash vectors', () => {
  for (const v of VECTORS) {
    assert.equal(v.bytes.toString('base64url'), v.token);
    assert.equal(pairingCode(v.token), v.code);
    assert.equal(tokenHash(v.token), v.hash);
  }
});

test('first vector, step by step', async () => {
  const { createHash } = await import('node:crypto');
  const d = createHash('sha256').update('dogeuni-agent-pair:AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8').digest();
  assert.equal(d.subarray(0, 4).toString('hex'), '41d7d384');
  assert.equal(d.readUInt32BE(0), 1104663428);
  assert.equal(1104663428 % 1_000_000, 663428);
});

test('generateToken: 43-char unpadded base64url of 32 bytes', () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const t = generateToken();
    assert.match(t, TOKEN_RE);
    assert.equal(Buffer.from(t, 'base64url').length, 32);
    seen.add(t);
  }
  assert.equal(seen.size, 50);
});

test('normalizeName: 1–40 code points, trimmed, no control characters', () => {
  assert.equal(normalizeName('  Claude Code '), 'Claude Code');
  assert.equal(normalizeName('x'.repeat(40)), 'x'.repeat(40));
  assert.equal(normalizeName('😀'.repeat(40)), '😀'.repeat(40));
  assert.equal(normalizeName(''), null);
  assert.equal(normalizeName('   '), null);
  assert.equal(normalizeName('x'.repeat(41)), null);
  assert.equal(normalizeName('a\nb'), null);
});
