/**
 * Streaming log-mel features as NeMo's FilterbankFeatures computes them for model A, the FastConformer word model
 * (spec §5.4; the Python reference is scripts/export-fastconformer-golden.py): 16 kHz samples in [-1, 1],
 * pre-emphasis 0.97, a symmetric 400-sample Hann window every 160 samples centred on the hop marks (zero padding
 * at both ends), 512-point power spectrum, 80 librosa Slaney mel bins over 0–8000 Hz, ln(x + 2^-24), one frame
 * per full hop (samples // 160). Then the model's fixed global CMVN: (x − mean) / (std + 1e-5).
 *
 * `push()` returns the frames whose window is complete; `finish()` returns the rest, zero-padded at the end.
 */
import FFT from "fft.js";

const SR = 16000;
const HOP = 160;
const WIN = 400;
const NFFT = 512;
const BINS = 80;
const PREEMPH = 0.97;
const LOG_GUARD = 2 ** -24;

/** librosa's Slaney mel scale: linear below 1 kHz, logarithmic above. */
const F_SP = 200 / 3;
const LOG_STEP = Math.log(6.4) / 27;
const hzToMel = (hz: number) => (hz >= 1000 ? 15 + Math.log(hz / 1000) / LOG_STEP : hz / F_SP);
const melToHz = (m: number) => (m >= 15 ? 1000 * Math.exp(LOG_STEP * (m - 15)) : F_SP * m);

/** librosa.filters.mel(sr=16000, n_fft=512, n_mels=80, fmin=0, fmax=8000, norm="slaney"), as float32. */
function melBanks(): { first: Int32Array; weights: Float64Array[] } {
  const lo = hzToMel(0);
  const hi = hzToMel(SR / 2);
  const f = Array.from({ length: BINS + 2 }, (_, i) => melToHz(lo + ((hi - lo) * i) / (BINS + 1)));
  const first = new Int32Array(BINS);
  const weights: Float64Array[] = [];
  for (let b = 0; b < BINS; b++) {
    const enorm = 2 / (f[b + 2] - f[b]);
    const w: number[] = [];
    let start = -1;
    for (let k = 0; k <= NFFT / 2; k++) {
      const hz = (k * SR) / NFFT;
      const v = Math.max(0, Math.min((hz - f[b]) / (f[b + 1] - f[b]), (f[b + 2] - hz) / (f[b + 2] - f[b + 1])));
      if (v > 0) {
        if (start < 0) start = k;
        w.push(Math.fround(v * enorm));
      } else if (start >= 0) break;
    }
    first[b] = start;
    weights.push(Float64Array.from(w));
  }
  return { first, weights };
}

const HANN = Float64Array.from({ length: WIN }, (_, i) => Math.fround(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1))));
let banks: ReturnType<typeof melBanks> | null = null;

export interface Cmvn {
  mean: Float32Array;
  std: Float32Array;
}

export class NemoMel {
  static readonly bins = BINS;
  private fft = new FFT(NFFT);
  private input: number[];
  private spectrum: number[];
  /** pre-emphasized samples kept from absolute index `base` */
  private buf = new Float32Array(0);
  private base = 0;
  private received = 0;
  private last = 0; // previous raw sample, for pre-emphasis across pushes
  private next = 0; // next frame index

  constructor(private cmvn?: Cmvn) {
    banks ??= melBanks();
    this.input = new Array(NFFT).fill(0);
    this.spectrum = this.fft.createComplexArray() as number[];
  }

  /** Frames ready so far, as one Float32Array of (frames × 80). */
  push(x: Float32Array): Float32Array {
    const merged = new Float32Array(this.buf.length + x.length);
    merged.set(this.buf);
    for (let i = 0; i < x.length; i++) {
      merged[this.buf.length + i] = this.received + i === 0 ? x[0] : x[i] - PREEMPH * (i ? x[i - 1] : this.last);
    }
    if (x.length) this.last = x[x.length - 1];
    this.buf = merged;
    this.received += x.length;
    return this.emit(false);
  }

  finish(): Float32Array {
    return this.emit(true);
  }

  private emit(final: boolean): Float32Array {
    const n = this.received;
    const total = final ? Math.floor(n / HOP) : Infinity;
    const out: number[] = [];
    while (this.next < total) {
      const s0 = this.next * HOP - WIN / 2;
      if (!final && s0 + WIN > n) break;
      this.compute(s0, n, out);
      this.next++;
    }
    const keepFrom = Math.min(n, Math.max(0, this.next * HOP - WIN / 2));
    if (keepFrom > this.base) {
      this.buf = this.buf.slice(keepFrom - this.base);
      this.base = keepFrom;
    }
    return Float32Array.from(out);
  }

  private compute(s0: number, n: number, out: number[]) {
    const inp = this.input;
    for (let i = 0; i < WIN; i++) {
      const s = s0 + i;
      inp[i] = s < 0 || s >= n ? 0 : this.buf[s - this.base] * HANN[i];
    }
    for (let i = WIN; i < NFFT; i++) inp[i] = 0;
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
      const v = Math.log(e + LOG_GUARD);
      out.push(this.cmvn ? (v - this.cmvn.mean[b]) / (this.cmvn.std[b] + 1e-5) : v);
    }
  }
}

/** Reads float32 arrays from an uncompressed .npz (numpy.savez), such as the model's streaming_global_cmvn.npz. */
export function readNpz(bytes: Uint8Array): Record<string, Float32Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, Float32Array> = {};
  const text = new TextDecoder();
  let p = 0;
  while (p + 30 <= bytes.length && view.getUint32(p, true) === 0x04034b50) {
    const method = view.getUint16(p + 8, true);
    const size = view.getUint32(p + 18, true);
    const nameLen = view.getUint16(p + 26, true);
    const extraLen = view.getUint16(p + 28, true);
    const name = text.decode(bytes.subarray(p + 30, p + 30 + nameLen));
    const data = p + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error(`${name}: compressed .npz entries are not supported`);
    // .npy: magic, version, header length, a Python dict header, then the raw array
    const major = bytes[data + 6];
    const headerLen = major === 1 ? view.getUint16(data + 8, true) : view.getUint32(data + 8, true);
    const headerStart = data + (major === 1 ? 10 : 12);
    const header = text.decode(bytes.subarray(headerStart, headerStart + headerLen));
    if (!/'descr':\s*'<f4'/.test(header) || /'fortran_order':\s*True/.test(header)) throw new Error(`${name}: expected little-endian float32, C order`);
    const body = headerStart + headerLen;
    const count = (size - (body - data)) / 4;
    out[name.replace(/\.npy$/, "")] = new Float32Array(bytes.slice(body, body + count * 4).buffer);
    p = data + size;
  }
  return out;
}
