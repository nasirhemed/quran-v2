/**
 * The streaming ASR pipeline for model B (spec §4, §5.4), as plain TypeScript: audio at the capture rate →
 * resampler → Kaldi fbank → 61-frame windows every 48 frames → ONNX Runtime → greedy CTC. It runs unchanged in
 * the ASR worker (onnxruntime-web in the browser) and in Node tests (onnxruntime-web's WebAssembly backend), and
 * reproduces spike/recitation/asr/stream.py step for step.
 *
 * The caller passes in the `ort` module and a created session, so this file never touches the DOM or workers.
 */
import type * as Ort from "onnxruntime-web";
import { KaldiFbank } from "./features/kaldiFbank";
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

/** Holds the model's recurrent state between calls: every input after the first is a state, fed back in order. */
export class ZipformerStepper {
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
    const x = new this.ort.Tensor("float32", window, [1, chunkInputFrames, KaldiFbank.bins]);
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

export class AsrPipeline {
  private resampler: Resampler;
  private fbank = new KaldiFbank();
  /** features not yet consumed, from absolute frame `featBase` */
  private feats = new Float32Array(0);
  private featBase = 0;
  private featTotal = 0;
  private step = 0;
  private prev = -1;
  private outFrame = 0;
  private samples16 = 0;
  private finished = false;

  constructor(private stepper: ZipformerStepper, private pack: ModelPack, readonly inputRate: number) {
    this.resampler = new Resampler(inputRate, FEATURE_RATE);
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
    this.featTotal += f.length / KaldiFbank.bins;
  }

  /** Steps whose input window is complete. */
  get stepsReady(): number {
    const { chunkInputFrames: win, chunkHopFrames: hop } = this.pack.streaming;
    return this.featTotal < win ? 0 : Math.floor((this.featTotal - win) / hop) + 1 - this.step;
  }

  /** Runs one model step if its window is ready. */
  async runStep(): Promise<StepResult | null> {
    if (this.stepsReady <= 0) return null;
    const { chunkInputFrames: win, chunkHopFrames: hop } = this.pack.streaming;
    const bins = KaldiFbank.bins;
    const lo = this.step * hop;
    const window = this.feats.slice((lo - this.featBase) * bins, (lo - this.featBase + win) * bins);
    const t0 = performance.now();
    const logprobs = await this.stepper.step(window);
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
   * End of input: flush the resampler and fbank, then pad the features the way the reference does (pad_tail_b:
   * the last real frames get their lookahead and the windows tile exactly). Call runStep() until it returns null.
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
    this.addFeats(new Float32Array(extra * KaldiFbank.bins).fill(flush.value));
  }
}
