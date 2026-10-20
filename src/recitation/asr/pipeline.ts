/**
 * The streaming ASR pipeline (spec §4, §5.4), as plain TypeScript: audio at the capture rate → resampler →
 * features → fixed windows of feature frames → ONNX Runtime → greedy CTC. Everything model-specific comes from the
 * pack. Model B: Kaldi fbank, 61-frame windows every 48 frames, its 98 states read from the graph; reproduces
 * spike/recitation/asr/stream.py step for step. Model A: NeMo log-mel with the pack's global CMVN, 112-frame
 * windows end to end, the last one shorter, three cache tensors; reproduces scripts/export-fastconformer-golden.py.
 * It runs unchanged in the ASR worker (onnxruntime-web in the browser) and in Node tests (onnxruntime-web's
 * WebAssembly backend).
 *
 * The caller passes in the `ort` module and a created session, so this file never touches the DOM or workers.
 */
import type * as Ort from "onnxruntime-web";
import { KaldiFbank } from "./features/kaldiFbank";
import { NemoMel, type Cmvn } from "./features/nemoMel";
import type { ModelPack } from "./modelPack";
import { Resampler } from "./resample";

type OrtModule = Pick<typeof Ort, "Tensor">;

export interface StepResult {
  step: number;
  /** CTC-collapsed units first emitted in this step, with their absolute output frame */
  units: { id: number; frame: number }[];
  /** this step's log-probs, (frames × vocab) */
  logprobs: Float32Array;
  frames: number;
  /** last output frame of this step */
  audioEndFrame: number;
  /** 16 kHz sample index where this step's audio ends (for capture-time latency) */
  audioEndSample: number;
  /** for each unit, the 16 kHz sample where its audio ends (approximate: output frame f ≈ fbank frames 4f..4f+3) */
  unitEndSamples: number[];
  /** model inference time */
  inferMs: number;
}

const FEATURE_RATE = 16000;
const FBANK_SHIFT = 160;
const BINS = 80;

/** One model call: a window of feature frames (frames × 80, time-major) in, (output frames × vocab) log-probs out. */
export interface Stepper {
  readonly vocab: number;
  step(window: Float32Array, frames: number): Promise<Float32Array>;
}

/** Model B. Holds the model's recurrent state between calls: every input after the first is a state, fed back in order. */
export class ZipformerStepper implements Stepper {
  private states: Record<string, Ort.Tensor>;
  readonly vocab: number;

  constructor(private ort: OrtModule, private session: Ort.InferenceSession, private pack: ModelPack, vocab: number) {
    this.vocab = vocab;
    this.states = this.initialStates();
  }

  private initialStates(): Record<string, Ort.Tensor> {
    const meta = this.session.inputMetadata as unknown as { name: string; type: string; shape: (number | string)[] }[];
    const states: Record<string, Ort.Tensor> = {};
    for (const m of meta.slice(1)) {
      const shape = m.shape.map((d) => (typeof d === "number" ? d : 1));
      const n = shape.reduce((a, b) => a * b, 1);
      states[m.name] =
        m.type === "int64" ? new this.ort.Tensor("int64", new BigInt64Array(n), shape) : new this.ort.Tensor("float32", new Float32Array(n), shape);
    }
    return states;
  }

  async step(window: Float32Array): Promise<Float32Array> {
    const { chunkInputFrames } = this.pack.streaming;
    const x = new this.ort.Tensor("float32", window, [1, chunkInputFrames, BINS]);
    const inputs = this.session.inputNames;
    const outputs = this.session.outputNames;
    const out = await this.session.run({ [inputs[0]]: x, ...this.states });
    // Python pairs inputs[1:] with outputs[1:] by position; so do we.
    const next: Record<string, Ort.Tensor> = {};
    for (let i = 1; i < inputs.length; i++) next[inputs[i]] = out[outputs[i]];
    for (const t of Object.values(this.states)) t.dispose?.();
    this.states = next;
    const lp = out[outputs[0]];
    const data = (lp.data as Float32Array).slice();
    lp.dispose?.();
    return data;
  }
}

/**
 * Model A (cache-aware FastConformer): features go in as (1, 80, frames) with their length; the pack names each
 * cache tensor and the output it is carried over from. Caches start at zero.
 */
export class CacheAwareStepper implements Stepper {
  private states: Record<string, Ort.Tensor> = {};

  constructor(private ort: OrtModule, private session: Ort.InferenceSession, private pack: ModelPack, readonly vocab: number) {
    const specs = pack.streaming.states;
    if (specs === "from-graph") throw new Error(`${pack.id}: a cache-aware pack lists its states`);
    for (const st of specs) {
      const n = st.shape.reduce((a, b) => a * b, 1);
      this.states[st.input] = st.dtype === "int64" ? new ort.Tensor("int64", new BigInt64Array(n), st.shape) : new ort.Tensor("float32", new Float32Array(n), st.shape);
    }
  }

  async step(window: Float32Array, frames: number): Promise<Float32Array> {
    const { lengthInput, logProbsOutput, states } = this.pack.streaming;
    const bft = new Float32Array(frames * BINS);
    for (let t = 0; t < frames; t++) for (let b = 0; b < BINS; b++) bft[b * frames + t] = window[t * BINS + b];
    const feeds: Record<string, Ort.Tensor> = { ...this.states, [this.session.inputNames[0]]: new this.ort.Tensor("float32", bft, [1, BINS, frames]) };
    if (lengthInput) feeds[lengthInput] = new this.ort.Tensor("int64", BigInt64Array.of(BigInt(frames)), [1]);
    const out = await this.session.run(feeds);
    for (const t of Object.values(this.states)) t.dispose?.();
    const next: Record<string, Ort.Tensor> = {};
    for (const st of states as Exclude<typeof states, "from-graph">) next[st.input] = out[st.output];
    this.states = next;
    const data = (out[logProbsOutput].data as Float32Array).slice();
    const kept = new Set(Object.values(next));
    for (const t of Object.values(out)) if (!kept.has(t)) t.dispose?.();
    return data;
  }
}

/** The stepper a pack needs. */
export function createStepper(ort: OrtModule, session: Ort.InferenceSession, pack: ModelPack, vocab: number): Stepper {
  return pack.streaming.states === "from-graph" ? new ZipformerStepper(ort, session, pack, vocab) : new CacheAwareStepper(ort, session, pack, vocab);
}

interface FeatureStream {
  push(x: Float32Array): Float32Array;
  finish(): Float32Array;
}

export class AsrPipeline {
  private resampler: Resampler;
  private fbank: FeatureStream;
  /** features not yet consumed, from absolute frame `featBase` */
  private feats = new Float32Array(0);
  private featBase = 0;
  private featTotal = 0;
  private step = 0;
  private prev = -1;
  private outFrame = 0;
  private samples16 = 0;
  private finished = false;

  /** `cmvn`: model A's global normalization (from its pack's cmvnFile), required for nemo-mel packs. */
  constructor(private stepper: Stepper, private pack: ModelPack, readonly inputRate: number, cmvn?: Cmvn) {
    this.resampler = new Resampler(inputRate, FEATURE_RATE);
    if (pack.features.kind === "nemo-mel") {
      if (!cmvn) throw new Error(`${pack.id} needs its CMVN`);
      this.fbank = new NemoMel(cmvn);
    } else this.fbank = new KaldiFbank();
  }

  /** 16 kHz samples produced so far (after resampling). */
  get samplesIn() {
    return this.samples16;
  }

  /** Accepts audio at the input rate; returns the 16 kHz samples it produced (for VAD and levels). */
  push(x: Float32Array): Float32Array {
    const y = this.resampler.push(x);
    this.addSamples(y);
    return y;
  }

  private addSamples(y: Float32Array) {
    this.samples16 += y.length;
    this.addFeats(this.fbank.push(y));
  }

  private addFeats(f: Float32Array) {
    if (!f.length) return;
    const merged = new Float32Array(this.feats.length + f.length);
    merged.set(this.feats);
    merged.set(f, this.feats.length);
    this.feats = merged;
    this.featTotal += f.length / BINS;
  }

  /** Steps whose input window is complete (after finish(), with a "shortChunk" pack: plus a last, shorter one). */
  get stepsReady(): number {
    const { chunkInputFrames: win, chunkHopFrames: hop } = this.pack.streaming;
    const full = this.featTotal < win ? 0 : Math.floor((this.featTotal - win) / hop) + 1;
    const short = this.finished && this.pack.streaming.flush.kind === "shortChunk" && this.featTotal > (full - 1) * hop + win ? 1 : 0;
    return full + short - this.step;
  }

  /** Runs one model step if its window is ready. */
  async runStep(): Promise<StepResult | null> {
    if (this.stepsReady <= 0) return null;
    const { chunkInputFrames, chunkHopFrames: hop } = this.pack.streaming;
    const bins = BINS;
    const lo = this.step * hop;
    const win = Math.min(chunkInputFrames, this.featTotal - lo);
    const window = this.feats.slice((lo - this.featBase) * bins, (lo - this.featBase + win) * bins);
    const t0 = performance.now();
    const logprobs = await this.stepper.step(window, win);
    const inferMs = performance.now() - t0;
    const vocab = this.stepper.vocab;
    const frames = logprobs.length / vocab;
    const blank = this.pack.units.blank;
    const units: StepResult["units"] = [];
    for (let t = 0; t < frames; t++) {
      let best = 0;
      let bestV = -Infinity;
      for (let v = 0; v < vocab; v++) {
        const x = logprobs[t * vocab + v];
        if (x > bestV) {
          bestV = x;
          best = v;
        }
      }
      if (best !== this.prev && best !== blank) units.push({ id: best, frame: this.outFrame });
      this.prev = best;
      this.outFrame++;
    }
    // drop features the next window no longer needs
    const keep = (this.step + 1) * hop;
    if (keep > this.featBase) {
      this.feats = this.feats.slice((keep - this.featBase) * bins);
      this.featBase = keep;
    }
    const lastFeat = lo + win - 1;
    const audioEndSample = Math.min(this.samples16, lastFeat * FBANK_SHIFT + FBANK_SHIFT / 2 + 200);
    const sub = hop / this.pack.streaming.chunkOutputFrames;
    const unitEndSamples = units.map((u) => Math.min(this.samples16, ((u.frame + 1) * sub - 1) * FBANK_SHIFT + FBANK_SHIFT / 2 + 200));
    return { step: this.step++, units, logprobs, frames, audioEndFrame: this.outFrame - 1, audioEndSample, unitEndSamples, inferMs };
  }

  /**
   * End of input: flush the resampler and features, then either pad the features the way model B's reference does
   * (pad_tail_b: the last real frames get their lookahead and the windows tile exactly) or, for model A, leave the
   * rest for one shorter window. Call runStep() until it returns null.
   */
  finish() {
    if (this.finished) return;
    this.finished = true;
    this.addSamples(this.resampler.finish());
    this.addFeats(this.fbank.finish());
    const { chunkInputFrames: win, chunkHopFrames: hop } = this.pack.streaming;
    const flush = this.pack.streaming.flush;
    if (flush.kind !== "padFeatures") return;
    const n = this.featTotal;
    const mod = (a: number, m: number) => ((a % m) + m) % m;
    const extra = n > win ? mod(-(n - win), hop) + hop : win - n + hop;
    this.addFeats(new Float32Array(extra * BINS).fill(flush.value));
  }
}
