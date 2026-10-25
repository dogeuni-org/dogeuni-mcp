import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_INBOUND, MessageDecoder, encodeMessage } from '../src/framing.js';

const collect = (opts = {}) => {
  const out = { msgs: [], invalid: [] };
  out.dec = new MessageDecoder({ onMessage: (m) => out.msgs.push(m), onInvalid: (r) => out.invalid.push(r), ...opts });
  return out;
};

test('encode: 4-byte little-endian length + UTF-8 JSON', () => {
  const msg = { v: 1, type: 'closed', conn: 3, s: 'ドージ' };
  const frame = encodeMessage(msg);
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  assert.equal(frame.readUInt32LE(0), body.length);
  assert.deepEqual(frame.subarray(4), body);
});

test('round-trip, several messages in one chunk', () => {
  const c = collect();
  const msgs = [{ a: 1 }, { b: 'two' }, [3], 'four', null];
  c.dec.push(Buffer.concat(msgs.map(encodeMessage)));
  assert.deepEqual(c.msgs, msgs);
});

test('partial chunks: byte by byte, and splits inside the header', () => {
  const msgs = [{ id: 1, result: { address: 'D'.repeat(34) } }, { id: 2, s: 'é😀' }];
  const all = Buffer.concat(msgs.map(encodeMessage));
  const c = collect();
  for (let i = 0; i < all.length; i++) c.dec.push(all.subarray(i, i + 1));
  assert.deepEqual(c.msgs, msgs);

  const c2 = collect();
  c2.dec.push(all.subarray(0, 2));
  c2.dec.push(all.subarray(2, 9));
  c2.dec.push(all.subarray(9));
  assert.deepEqual(c2.msgs, msgs);
});

test('oversized frame is skipped (across chunks) and the next frame still decodes', () => {
  const c = collect();
  const header = Buffer.alloc(4);
  header.writeUInt32LE(MAX_INBOUND + 1, 0);
  const junk = Buffer.alloc(MAX_INBOUND + 1, 0x20);
  const next = encodeMessage({ ok: true });
  const all = Buffer.concat([header, junk, next]);
  c.dec.push(all.subarray(0, 1000));
  c.dec.push(all.subarray(1000, 600_000));
  c.dec.push(all.subarray(600_000));
  assert.deepEqual(c.msgs, [{ ok: true }]);
  assert.equal(c.invalid.length, 1);
});

test('frame of exactly 1 MiB is accepted', () => {
  const c = collect();
  const s = 'x'.repeat(MAX_INBOUND - 2);
  const body = Buffer.from(JSON.stringify(s));
  assert.equal(body.length, MAX_INBOUND);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  c.dec.push(Buffer.concat([header, body]));
  assert.deepEqual(c.msgs, [s]);
});

test('invalid JSON / invalid UTF-8 frames are reported and skipped', () => {
  const c = collect();
  const bad = (b) => {
    const h = Buffer.alloc(4);
    h.writeUInt32LE(b.length, 0);
    return Buffer.concat([h, b]);
  };
  c.dec.push(Buffer.concat([bad(Buffer.from('{nope')), bad(Buffer.from([0x22, 0xff, 0x22])), encodeMessage({ ok: 1 })]));
  assert.deepEqual(c.msgs, [{ ok: 1 }]);
  assert.equal(c.invalid.length, 2);
});

test('encode refuses messages over 1 MiB', () => {
  assert.throws(() => encodeMessage('x'.repeat(1024 * 1024)), RangeError);
});
