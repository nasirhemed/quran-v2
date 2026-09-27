/**
 * The ASR worker (spec §4): loads the model pack from on-device storage, pulls microphone audio from the shared
 * ring buffer (or fed samples, for files and tests), runs the streaming pipeline and emits one ChunkEvent per
 * model step. All the signal processing lives in ../asr/ (plain TS, tested in Node); this file is only the host.
 *
 * Times in events are epoch milliseconds (performance.timeOrigin + performance.now()), so the main thread can
 * compare them with its own clock.
 */
import * as ort from "onnxruntime-web/wasm";
import { MODEL_PACKS, type ModelPack } from "../asr/modelPack";
import { ModelStore, OpfsFileStore } from "../asr/modelStore";
import { AsrPipeline, ZipformerStepper } from "../asr/pipeline";
import { RingReader } from "../asr/ring";
import { EnergyVad } from "../asr/vad";
import type { SourceEvents } from "../sources/RecognizerSource";
import type { FromWorker, ToWorker } from "./protocol";

const scope = self as unknown as { postMessage(m: FromWorker, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<ToWorker>) => void) | null };
const post = (m: FromWorker, transfer: Transferable[] = []) => scope.postMessage(m, transfer);
const emit = <E extends keyof SourceEvents>(name: E, payload: SourceEvents[E]) => post({ type: "event", name, payload });
const now = () => performance.timeOrigin + performance.now();

const FEATURE_RATE = 16000;
const OUTPUT_FRAME_SAMPLES = 640; // 40 ms at 16 kHz
const LEVEL_EVERY_MS = 100;
const POLL_MS = 20;
const BEHIND_MS = 1500;
const CAUGHT_UP_MS = 500;

let pack: ModelPack | null = null;
let session: ort.InferenceSession | null = null;
let symbols: string[] = [];

interface Run {
  id: string;
  rate: number;
  pipe: AsrPipeline;
  vad: EnergyVad;
  chunk: number;
  logprobs: Float32Array[];
  reader: RingReader | null;
  epochAtContextZero: number;
  lastLevel: number;
  behind: boolean;
  lostReported: number;
  /** input samples taken from the ring so far (including any lost) */
  taken: number;
  /** recent (time, offset) observations tying the audio clock to this clock; see anchor() */
  offsets: { t: number; offset: number }[];
  firstOffset: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}
let run: Run | null = null;
let queue: Promise<void> = Promise.resolve();
const enqueue = (f: () => Promise<void> | void) => (queue = queue.then(f).catch((e) => fail("processing", e)));

function fail(code: string, e: unknown) {
  emit("error", { code, message: e instanceof Error ? e.message : String(e) });
}

async function load(packId: string, threads: number) {
  const t0 = performance.now();
  emit("state", { state: "loading" });
  const p = MODEL_PACKS.find((x) => x.id === packId);
  if (!p) throw new Error(`Unknown model pack ${packId}`);
  const store = new ModelStore(new OpfsFileStore());
  if ((await store.status(p)).state !== "ready") {
    emit("error", { code: "model_missing", message: "Model not downloaded" });
    emit("state", { state: "idle", reason: "model_missing" });
    return;
  }
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = threads;
  ort.env.logLevel = "error";
  const bytes = new Uint8Array(await (await store.file(p, p.files[0].name)).arrayBuffer());
  session?.release();
  session = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const tokens = await (await store.file(p, p.units.tokensFile)).text();
  symbols = [];
  for (const line of tokens.split("\n")) {
    const m = /^(.*) (\d+)$/.exec(line.trimEnd());
    if (m) symbols[Number(m[2])] = m[1];
  }
  pack = p;
  post({ type: "loaded", symbols, loadMs: performance.now() - t0, threads: ort.env.wasm.numThreads as number, packId });
  emit("state", { state: "idle" });
}

function begin(id: string, rate: number): Run {
  if (!session || !pack) throw new Error("The model is not loaded");
  return {
    id,
    rate,
    pipe: new AsrPipeline(new ZipformerStepper(ort, session, pack, symbols.length), pack, rate),
    vad: new EnergyVad(),
    chunk: 0,
    logprobs: [],
    reader: null,
    epochAtContextZero: 0,
    lastLevel: 0,
    behind: false,
    lostReported: 0,
    taken: 0,
    offsets: [],
    firstOffset: null,
    timer: null,
    stopped: false,
  };
}

/** Input sample `i` by the audio clock (epoch ms). The audio clock drifts against ours (~0.01–0.1%). */
function audioClock(r: Run, i: number, first: number): number {
  return r.epochAtContextZero + ((first + i) / r.rate) * 1000;
}

const ANCHOR_WINDOW_MS = 3000;

/**
 * Re-anchors the audio clock to ours on every poll: when we take samples up to index n at time T, the newest one
 * was captured no later than T. The smallest (T − audioClock(n)) over the last few seconds is the capture-to-
 * worker delay without polling jitter, and it absorbs clock drift, which would otherwise grow without bound.
 */
function anchor(r: Run) {
  const first = r.reader?.firstFrame;
  if (first == null || r.taken === 0) return;
  const t = now();
  const offset = t - audioClock(r, r.taken, first);
  r.firstOffset ??= offset;
  r.offsets.push({ t, offset });
  while (r.offsets.length && r.offsets[0].t < t - ANCHOR_WINDOW_MS) r.offsets.shift();
}

const currentOffset = (r: Run) => r.offsets.reduce((m, o) => Math.min(m, o.offset), Infinity);

/** When the audio up to 16 kHz sample `s` was captured, on our clock; null for fed audio (no capture clock). */
function captureTime(r: Run, s: number): number | null {
  const first = r.reader?.firstFrame;
  if (first == null || !r.offsets.length) return null;
  return audioClock(r, (s * r.rate) / FEATURE_RATE, first) + currentOffset(r);
}

async function process(r: Run, x: Float32Array) {
  const y = r.pipe.push(x);
  for (const c of r.vad.push(y)) emit("vad", { speech: c.speech, atFrame: Math.floor(c.atSample / OUTPUT_FRAME_SAMPLES) });
  if (now() - r.lastLevel >= LEVEL_EVERY_MS) {
    r.lastLevel = now();
    emit("level", { rms: r.vad.takeLevel() });
  }
  await steps(r);
}

async function steps(r: Run) {
  for (let res = await r.pipe.runStep(); res; res = await r.pipe.runStep()) {
    r.logprobs.push(res.logprobs);
    const emittedAtMs = now();
    emit("chunk", { session: r.id, chunk: r.chunk++, units: res.units, audioEndFrame: res.audioEndFrame, emittedAtMs, captureAtMs: captureTime(r, res.audioEndSample) ?? emittedAtMs });
    const backlogMs = r.reader ? (r.reader.available / r.rate) * 1000 : 0;
    const stepAudioMs = pack!.streaming.chunkHopFrames * 10;
    const unitCaptureAtMs = r.reader && r.offsets.length ? res.unitEndSamples.map((s) => captureTime(r, s)!) : [];
    const clockDriftMs = r.firstOffset != null && r.offsets.length ? currentOffset(r) - r.firstOffset : 0;
    post({ type: "step", inferMs: res.inferMs, stepAudioMs, backlogMs, unitCaptureAtMs, clockDriftMs });
  }
}

function tick(r: Run) {
  enqueue(async () => {
    if (r.stopped || !r.reader) return;
    const x = r.reader.take();
    r.taken += x.length + (r.reader.lost - r.lostReported);
    if (r.reader.lost > r.lostReported) {
      r.lostReported = r.reader.lost;
      fail("audio_lost", new Error(`Fell behind and lost ${(r.reader.lost / r.rate).toFixed(1)} s of audio`));
    }
    anchor(r);
    if (x.length) await process(r, x);
    const backlogMs = (r.reader.available / r.rate) * 1000;
    if (!r.behind && backlogMs > BEHIND_MS) {
      r.behind = true;
      emit("state", { state: "behind", reason: "Can't keep up on this device" });
    } else if (r.behind && backlogMs < CAUGHT_UP_MS) {
      r.behind = false;
      emit("state", { state: "listening" });
    }
  }).then(() => {
    if (!r.stopped) r.timer = setTimeout(() => tick(r), POLL_MS);
  });
}

async function stop() {
  const r = run;
  if (!r) return post({ type: "stopped" });
  emit("state", { state: "stopping" });
  r.stopped = true;
  if (r.timer) clearTimeout(r.timer);
  await enqueue(async () => {
    if (r.reader) {
      const rest = r.reader.take();
      r.taken += rest.length;
      anchor(r);
      if (rest.length) await process(r, rest);
    }
    r.pipe.finish(); // flush: resampler tail, last fbank frames, padding for the final lookahead
    await steps(r);
  });
  emit("state", { state: "idle" });
  post({ type: "stopped" });
}

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    switch (m.type) {
      case "load":
        enqueue(() => load(m.packId, m.threads));
        break;
      case "start":
        enqueue(() => {
          run = begin(m.session, m.sampleRate);
          run.reader = new RingReader(m.ring);
          run.epochAtContextZero = m.epochAtContextZero;
          emit("state", { state: "listening" });
          tick(run);
        });
        break;
      case "startFeed":
        enqueue(() => {
          run = begin(m.session, m.sampleRate);
          emit("state", { state: "listening" });
        });
        break;
      case "feed":
        enqueue(() => (run && !run.stopped ? process(run, m.samples) : undefined));
        break;
      case "stop":
        void stop();
        break;
      case "logProbs": {
        const parts = run?.logprobs ?? [];
        const data = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
        let o = 0;
        for (const p of parts) {
          data.set(p, o);
          o += p.length;
        }
        post({ type: "logProbs", data, vocab: symbols.length, blank: pack?.units.blank ?? 0 }, [data.buffer]);
        break;
      }
    }
  } catch (err) {
    fail("worker", err);
  }
};
