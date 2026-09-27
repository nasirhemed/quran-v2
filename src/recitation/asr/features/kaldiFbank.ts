/**
 * Streaming Kaldi log-mel filterbank, as kaldi-native-fbank computes it for model B (spec §5.4; the Python
 * reference is spike/recitation/asr/features.py `fbank_b`): 16 kHz samples in [-1, 1], 25 ms Povey windows every
 * 10 ms, snip_edges false (frames centred on 10 ms marks, edges reflected), DC removal, pre-emphasis 0.97,
 * 512-point power spectrum, 80 triangular mel bins over 20–7600 Hz, natural log floored at FLT_EPSILON.
 *
 * `push()` returns the frames whose window is complete; `finish()` returns the rest, reflecting at the end,
 * exactly as Kaldi's OnlineFbank does after input_finished().
 */
import FFT from "fft.js";

const SR = 16000;
const SHIFT = 160;
const LENGTH = 400;
const NFFT = 512;
const BINS = 80;
const PREEMPH = 0.97;
const FLT_EPSILON = 1.1920928955078125e-7;
const LOW_HZ = 20;
const HIGH_HZ = SR / 2 - 400;

const mel = (hz: number) => 1127 * Math.log(1 + hz / 700);

function melBanks(): { first: Int32Array; weights: Float64Array[] } {
  const lo = mel(LOW_HZ);
  const hi = mel(HIGH_HZ);
  const delta = (hi - lo) / (BINS + 1);
  const first = new Int32Array(BINS);
  const weights: Float64Array[] = [];
  for (let b = 0; b < BINS; b++) {
    const left = lo + b * delta;
    const center = lo + (b + 1) * delta;
    const right = lo + (b + 2) * delta;
    const w: number[] = [];
    let start = -1;
    for (let i = 0; i < NFFT / 2; i++) {
      const m = mel((i * SR) / NFFT);
      if (m > left && m < right) {
        if (start < 0) start = i;
        w.push(m <= center ? (m - left) / (center - left) : (right - m) / (right - center));
      } else if (start >= 0) break;
    }
    first[b] = start;
    weights.push(Float64Array.from(w));
  }
  return { first, weights };
}

const POVEY = Float64Array.from({ length: LENGTH }, (_, i) => Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (LENGTH - 1)), 0.85));
let banks: ReturnType<typeof melBanks> | null = null;

export class KaldiFbank {
  static readonly bins = BINS;
  private fft = new FFT(NFFT);
  private frame = new Float64Array(LENGTH);
  private input: number[];
  private spectrum: number[];
  /** samples kept from absolute index `base` */
  private buf = new Float32Array(0);
  private base = 0;
  private received = 0;
  private next = 0; // next frame index

  constructor() {
    banks ??= melBanks();
    this.input = new Array(NFFT).fill(0);
    this.spectrum = this.fft.createComplexArray() as number[];
  }

  /** Frames ready so far, as one Float32Array of (frames × 80). */
  push(x: Float32Array): Float32Array {
    const merged = new Float32Array(this.buf.length + x.length);
    merged.set(this.buf);
    merged.set(x, this.buf.length);
    this.buf = merged;
    this.received += x.length;
    return this.emit(false);
  }

  finish(): Float32Array {
    return this.emit(true);
  }

  private start(j: number) {
    return j * SHIFT + SHIFT / 2 - LENGTH / 2;
  }

  private emit(final: boolean): Float32Array {
    const n = this.received;
    const total = final ? Math.floor((n + SHIFT / 2) / SHIFT) : Infinity;
    const out: number[] = [];
    while (this.next < total) {
      const s0 = this.start(this.next);
      if (!final && s0 + LENGTH > n) break;
      this.compute(s0, n, out);
      this.next++;
    }
    // Keep what the next frame needs. Frame 0 reflects around sample 0, so nothing is dropped before frame 1.
    const keepFrom = this.next === 0 ? 0 : Math.min(n, Math.max(0, this.start(this.next)));
    if (keepFrom > this.base) {
      this.buf = this.buf.slice(keepFrom - this.base);
      this.base = keepFrom;
    }
    return Float32Array.from(out);
  }

  private compute(s0: number, n: number, out: number[]) {
    const f = this.frame;
    let mean = 0;
    for (let i = 0; i < LENGTH; i++) {
      let s = s0 + i;
      if (s < 0) s = -s - 1;
      else if (s >= n) s = 2 * n - 1 - s;
      f[i] = this.buf[s - this.base];
      mean += f[i];
    }
    mean /= LENGTH;
    for (let i = 0; i < LENGTH; i++) f[i] -= mean;
    for (let i = LENGTH - 1; i > 0; i--) f[i] -= PREEMPH * f[i - 1];
    f[0] -= PREEMPH * f[0];
    const inp = this.input;
    for (let i = 0; i < LENGTH; i++) inp[i] = f[i] * POVEY[i];
    for (let i = LENGTH; i < NFFT; i++) inp[i] = 0;
    const sp = this.spectrum;
    this.fft.realTransform(sp, inp);
    const { first, weights } = banks!;
    for (let b = 0; b < BINS; b++) {
      const w = weights[b];
      const k0 = first[b];
      let e = 0;
      for (let k = 0; k < w.length; k++) {
        const re = sp[2 * (k0 + k)];
        const im = sp[2 * (k0 + k) + 1];
        e += w[k] * (re * re + im * im);
      }
      out.push(Math.log(Math.max(e, FLT_EPSILON)));
    }
  }
}
