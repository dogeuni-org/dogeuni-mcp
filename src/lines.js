// Newline-delimited JSON over the unix socket.

/** Max bytes per line, MCP -> host (excluding the newline). */
export const MAX_LINE = 64 * 1024;

/**
 * Splits a byte stream into lines. Calls `onOverflow` once (and stops) if a
 * line grows beyond `maxLine` bytes. A trailing "\r" is stripped.
 */
export class LineSplitter {
  /**
   * @param {{ onLine: (line: string) => void, onOverflow: () => void, maxLine?: number }} opts
   */
  constructor({ onLine, onOverflow, maxLine = MAX_LINE }) {
    this.onLine = onLine;
    this.onOverflow = onOverflow;
    this.maxLine = maxLine;
    /** @type {Buffer[]} */
    this.parts = [];
    this.size = 0;
    this.stopped = false;
  }

  stop() {
    this.stopped = true;
    this.parts = [];
  }

  /** @param {Buffer} chunk */
  push(chunk) {
    while (!this.stopped && chunk.length > 0) {
      const nl = chunk.indexOf(0x0a);
      if (nl === -1) {
        this.parts.push(chunk);
        this.size += chunk.length;
        if (this.size > this.maxLine) this.overflow();
        return;
      }
      const head = chunk.subarray(0, nl);
      chunk = chunk.subarray(nl + 1);
      let line = this.parts.length ? Buffer.concat([...this.parts, head]) : head;
      this.parts = [];
      this.size = 0;
      if (line.length > 0 && line[line.length - 1] === 0x0d) line = line.subarray(0, line.length - 1);
      if (line.length > this.maxLine) return this.overflow();
      this.onLine(line.toString('utf8'));
    }
  }

  overflow() {
    this.stop();
    this.onOverflow();
  }
}

export const isId = (v) => Number.isSafeInteger(v) && v > 0;
export const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
