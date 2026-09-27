/**
 * Single-producer, single-consumer audio ring buffer in shared memory (spec §4): the AudioWorklet writes each
 * 128-sample render quantum, the ASR worker reads. No locks: the writer publishes a running sample count.
 *
 * Header (Int32): [0] samples written so far (wraps at 2^31; readers use differences), [1] 1 once `firstFrame`
 * is set. Float64 at byte 8: the AudioContext frame of the first sample written (for capture timestamps).
 */
export interface RingBuffers {
  header: SharedArrayBuffer;
  data: SharedArrayBuffer;
}

/** `capacity` must be a power of two, so indices stay continuous when the running count wraps. */
export function createRing(capacity = 1 << 19): RingBuffers {
  if (capacity & (capacity - 1) || capacity > 0x40000000) throw new Error("ring capacity must be a power of two");
  return { header: new SharedArrayBuffer(16), data: new SharedArrayBuffer(capacity * 4) };
}

export class RingWriter {
  private count: Int32Array;
  private first: Float64Array;
  private data: Float32Array;
  private written = 0;
  constructor(r: RingBuffers) {
    this.count = new Int32Array(r.header, 0, 2);
    this.first = new Float64Array(r.header, 8, 1);
    this.data = new Float32Array(r.data);
  }
  write(x: Float32Array, contextFrame: number) {
    if (Atomics.load(this.count, 1) === 0) {
      this.first[0] = contextFrame;
      Atomics.store(this.count, 1, 1);
    }
    const cap = this.data.length;
    for (let i = 0; i < x.length; i++) this.data[(this.written + i) % cap] = x[i];
    this.written = (this.written + x.length) % 0x40000000;
    Atomics.store(this.count, 0, this.written);
  }
}

export class RingReader {
  private count: Int32Array;
  private first: Float64Array;
  private data: Float32Array;
  private read = 0;
  /** samples lost because the reader fell a whole buffer behind */
  lost = 0;
  constructor(r: RingBuffers) {
    this.count = new Int32Array(r.header, 0, 2);
    this.first = new Float64Array(r.header, 8, 1);
    this.data = new Float32Array(r.data);
  }
  /** AudioContext frame of the first captured sample, once known. */
  get firstFrame(): number | null {
    return Atomics.load(this.count, 1) ? this.first[0] : null;
  }
  /** Samples written but not yet read. */
  get available(): number {
    return (Atomics.load(this.count, 0) - this.read + 0x40000000) % 0x40000000;
  }
  /** Everything new since the last call. */
  take(): Float32Array {
    const cap = this.data.length;
    let n = this.available;
    if (n > cap) {
      // never silently: the caller reports `lost`
      this.lost += n - cap;
      this.read = (this.read + n - cap) % 0x40000000;
      n = cap;
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = this.data[(this.read + i) % cap];
    this.read = (this.read + n) % 0x40000000;
    return out;
  }
}
