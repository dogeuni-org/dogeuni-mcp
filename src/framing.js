// Chrome native messaging framing: 4-byte little-endian length + UTF-8 JSON.
// https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging

/** Largest message the host accepts from Chrome (Chrome allows up to 4 GiB). */
export const MAX_INBOUND = 1024 * 1024;
/** Largest message Chrome accepts from a host. */
export const MAX_OUTBOUND = 1024 * 1024;

/**
 * @param {unknown} msg
 * @returns {Buffer}
 */
export function encodeMessage(msg) {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  if (body.length > MAX_OUTBOUND) throw new RangeError(`native message too large: ${body.length} bytes`);
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * Incremental decoder. Frames larger than `maxSize` are skipped without being
 * buffered; frames that are not valid UTF-8 JSON are reported via `onInvalid`.
 */
export class MessageDecoder {
  /**
   * @param {{ onMessage: (msg: unknown) => void, onInvalid?: (reason: string) => void, maxSize?: number }} opts
   */
  constructor({ onMessage, onInvalid = () => {}, maxSize = MAX_INBOUND }) {
    this.onMessage = onMessage;
    this.onInvalid = onInvalid;
    this.maxSize = maxSize;
    /** @type {Buffer} */
    this.buf = Buffer.alloc(0);
    this.skip = 0;
  }

  /** @param {Buffer} chunk */
  push(chunk) {
    if (this.skip > 0) {
      const n = Math.min(this.skip, chunk.length);
      this.skip -= n;
      chunk = chunk.subarray(n);
      if (chunk.length === 0) return;
    }
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    for (;;) {
      if (this.buf.length < 4) return;
      const len = this.buf.readUInt32LE(0);
      if (len > this.maxSize) {
        this.onInvalid(`oversized frame (${len} bytes)`);
        const available = this.buf.length - 4;
        if (available >= len) {
          this.buf = this.buf.subarray(4 + len);
          continue;
        }
        this.skip = len - available;
        this.buf = Buffer.alloc(0);
        return;
      }
      if (this.buf.length < 4 + len) return;
      const body = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      let msg;
      try {
        msg = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
      } catch {
        this.onInvalid('frame is not UTF-8 JSON');
        continue;
      }
      this.onMessage(msg);
    }
  }
}
