/**
 * Streaming rational resampler, numerically the same as scipy's `resample_poly(x, up, down)` (spec §5.4):
 * a Kaiser-windowed sinc low-pass (β = 5, half-length 10·max(up, down)), applied polyphase.
 *
 *   y[k] = Σ_i x[i] · h[k·down + half − i·up]
 *
 * Microphones deliver 44.1 or 48 kHz; the models want 16 kHz. Output sample k is produced as soon as the input it
 * needs (half a filter length ahead) has arrived; `finish()` treats the missing tail as zeros, as scipy does.
 */

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** Modified Bessel function of the first kind, order 0 (for the Kaiser window). */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 200; k++) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/** scipy.signal.firwin(2·half+1, 1/maxRate, window=('kaiser', 5.0)) · up */
function designFilter(up: number, down: number): { h: Float64Array; half: number } {
  const maxRate = Math.max(up, down);
  const cutoff = 1 / maxRate;
  const half = 10 * maxRate;
  const n = 2 * half + 1;
  const h = new Float64Array(n);
  const beta = 5;
  const i0beta = besselI0(beta);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const m = i - half;
    const x = cutoff * m;
    const sinc = m === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    const r = (2 * i) / (n - 1) - 1;
    const win = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0beta;
    h[i] = cutoff * sinc * win;
    sum += h[i];
  }
  for (let i = 0; i < n; i++) h[i] = (h[i] / sum) * up;
  return { h, half };
}

export class Resampler {
  readonly up: number;
  readonly down: number;
  private h: Float64Array;
  private half: number;
  /** input kept from absolute index `base` onwards */
  private buf = new Float32Array(0);
  private base = 0;
  private received = 0;
  private next = 0; // next output index

  constructor(readonly inRate: number, readonly outRate: number) {
    const g = gcd(inRate, outRate);
    this.up = outRate / g;
    this.down = inRate / g;
    ({ h: this.h, half: this.half } = designFilter(this.up, this.down));
  }

  /** Resamples `x` (appended to what came before); returns the output samples that are now complete. */
  push(x: Float32Array): Float32Array {
    if (this.up === 1 && this.down === 1) return x.slice();
    const merged = new Float32Array(this.buf.length + x.length);
    merged.set(this.buf);
    merged.set(x, this.buf.length);
    this.buf = merged;
    this.received += x.length;
    return this.emit(false);
  }

  /** The remaining output, with the input's end padded by zeros. */
  finish(): Float32Array {
    if (this.up === 1 && this.down === 1) return new Float32Array(0);
    return this.emit(true);
  }

  private emit(final: boolean): Float32Array {
    const { up, down, half, h } = this;
    const total = final ? Math.ceil((this.received * up) / down) : Infinity;
    const out: number[] = [];
    for (;;) {
      const k = this.next;
      if (k >= total) break;
      const center = k * down + half;
      const iMax = Math.floor(center / up); // last input sample this output needs
      if (!final && iMax >= this.received) break;
      const iMin = Math.max(0, Math.ceil((center - 2 * half) / up));
      let acc = 0;
      const last = Math.min(iMax, this.received - 1);
      for (let i = iMin; i <= last; i++) acc += this.buf[i - this.base] * h[center - i * up];
      out.push(acc);
      this.next++;
    }
    // drop input no future output needs
    const keepFrom = Math.min(this.received, Math.max(0, Math.ceil((this.next * down - half) / up)));
    if (keepFrom > this.base) {
      this.buf = this.buf.slice(keepFrom - this.base);
      this.base = keepFrom;
    }
    return Float32Array.from(out);
  }
}
