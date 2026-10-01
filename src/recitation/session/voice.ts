/**
 * The voice session shared by the Transcribe screen and the reader's Follow mode (spec §4, §8): the ASR worker
 * (via BrowserSource), the engine worker (follow mode), and the state both screens render.
 *
 * One session per tab, created on first use (this module is loaded lazily, see ./lazy.ts). The state object is
 * replaced on change and published at most once per model step; finished transcript paragraphs keep their
 * identity so the UI never re-renders them.
 */
import { selectedPack } from "../asr/modelPack";
import { ModelStore, OpfsFileStore } from "../asr/modelStore";
import { BrowserSource, type Loaded } from "../sources/BrowserSource";
import type { ChunkEvent } from "../sources/RecognizerSource";
import type { FromEngine, KeyedEvent, VerifyResult } from "../workers/engineProtocol";

/** "checking" (model/index status on start-up) and "verifying" (verify mode's check after stop) differ. */
export type Phase = "checking" | "no-model" | "loading" | "ready" | "listening" | "stopping" | "verifying" | "error";

export type Mode = "follow" | "verify";

export interface VerifyState {
  status: "idle" | "recording" | "checking" | "done" | "error";
  result: VerifyResult | null;
  /** epoch ms when the verify recording started (for the time limit) */
  startedAt: number | null;
  error?: string;
}

/** Spec §7.6 [DECISION]: verify recordings are capped (the whole recording's log-probs are kept, ≈1.5 MB/min). */
export const VERIFY_MAX_MINUTES = 15;

export interface TranscriptItem {
  key: string; // "s:a:w"
  status: "match" | "repeat";
}

/** Words heard in one ayah (or a run of repeats); closed once the ayah is complete. */
export interface Paragraph {
  id: number;
  items: TranscriptItem[];
  /** "s:a" when this paragraph ended with the ayah's last word */
  ayahEnd: string | null;
  closed: boolean;
}

export interface RawLine {
  units: { id: number; frame: number }[];
  text: string;
}

export interface VoiceState {
  phase: Phase;
  mode: Mode;
  verify: VerifyState;
  message: string | null;
  loaded: Loaded | null;
  engineReady: boolean;
  level: number;
  speaking: boolean;
  quietSince: number;
  behind: boolean;
  /** follow mode */
  tracking: boolean;
  /** the word the cursor waits for next, and the last word heard */
  cursor: string | null;
  last: string | null;
  candidates: { key: string; score: number }[];
  pendingLetters: number;
  paragraphs: Paragraph[];
  /** the raw phonemes, for "Show sounds" */
  raw: RawLine[];
  statsVersion: number;
}

export interface VoiceStats {
  infer: number[];
  latency: number[];
  unitLatency: number[];
  cursorLag: number[];
  engineMs: number[];
  drift: number;
  backlogMax: number;
  steps: number;
  gaps: number;
  lastChunk: number;
  stepAudioMs: number;
  engineLoadMs: number;
}

const LINE_GAP_FRAMES = 15;
const STEP_S = 0.48;

const emptyStats = (): VoiceStats => ({
  infer: [],
  latency: [],
  unitLatency: [],
  cursorLag: [],
  engineMs: [],
  drift: 0,
  backlogMax: 0,
  steps: 0,
  gaps: 0,
  lastChunk: -1,
  stepAudioMs: 480,
  engineLoadMs: NaN,
});

export class VoiceSession {
  private static instance: VoiceSession | null = null;
  static get(): VoiceSession {
    return (VoiceSession.instance ??= new VoiceSession());
  }

  state: VoiceState = {
    phase: "checking",
    mode: "follow",
    verify: { status: "idle", result: null, startedAt: null },
    message: null,
    loaded: null,
    engineReady: false,
    level: 0,
    speaking: false,
    quietSince: 0,
    behind: false,
    tracking: false,
    cursor: null,
    last: null,
    candidates: [],
    pendingLetters: 0,
    paragraphs: [],
    raw: [],
    statsVersion: 0,
  };
  stats: VoiceStats = emptyStats();
  /** every engine event with its step, for tests and the acceptance run (debug) */
  readonly engineLog: { step: number; events: KeyedEvent[] }[] = [];

  private source: BrowserSource | null = null;
  private engine: Worker | null = null;
  private listeners = new Set<() => void>();
  private pending: Partial<VoiceState> | null = null;
  private flushQueued = false;
  private initPromise: Promise<void> | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private paragraphId = 0;
  private stepCapture = new Map<number, number>();
  private verified: ((r: VerifyResult) => void) | null = null;
  private verifyTimer: ReturnType<typeof setTimeout> | null = null;

  private constructor() {
    document.addEventListener("visibilitychange", () => {
      // spec §10.6: stop (with a flush) when the page is hidden
      if (document.visibilityState === "hidden" && this.state.phase === "listening") void this.stop();
    });
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<VoiceState>, now = false) {
    this.pending = { ...this.pending, ...patch };
    if (now) return this.flush();
    if (!this.flushQueued) {
      this.flushQueued = true;
      queueMicrotask(() => this.flush());
    }
  }

  private flush() {
    this.flushQueued = false;
    if (!this.pending) return;
    this.state = { ...this.state, ...this.pending };
    this.pending = null;
    this.listeners.forEach((fn) => fn());
  }

  /** The latest state including changes not yet published (for building the next change). */
  private get s(): VoiceState {
    return this.pending ? { ...this.state, ...this.pending } : this.state;
  }

  /** Loads the model and the Quran index once. Safe to call repeatedly. */
  init(): Promise<void> {
    return (this.initPromise ??= this.doInit().catch((e) => {
      this.initPromise = null;
      this.set({ phase: "error", message: e instanceof Error ? e.message : String(e) }, true);
    }));
  }

  private async doInit() {
    const pack = selectedPack();
    if ((await new ModelStore(new OpfsFileStore()).status(pack)).state !== "ready") {
      this.initPromise = null; // try again after the model is downloaded
      return this.set({ phase: "no-model" }, true);
    }
    this.set({ phase: "loading" }, true);
    const src = new BrowserSource();
    this.source = src;
    const loaded = await src.load(pack, 2);
    if (!loaded) {
      this.initPromise = null;
      return this.set({ phase: "no-model" }, true);
    }
    this.wireSource(src, loaded);
    this.engine = new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module", name: "itqan-engine" });
    this.engine.onmessage = (e: MessageEvent<FromEngine>) => this.onEngine(e.data);
    this.engine.postMessage({ type: "init", symbols: loaded.symbols });
    this.set({ loaded, phase: "ready" }, true);
  }

  private wireSource(src: BrowserSource, loaded: Loaded) {
    src.on("chunk", (c: ChunkEvent) => this.onChunk(c, loaded.symbols));
    src.onStep((st) => {
      const s = this.stats;
      s.infer.push(st.inferMs);
      s.stepAudioMs = st.stepAudioMs;
      s.backlogMax = Math.max(s.backlogMax, st.backlogMs);
      s.drift = st.clockDriftMs;
      const arrival = performance.timeOrigin + performance.now();
      for (const t of st.unitCaptureAtMs) s.unitLatency.push(arrival - t);
      if (st.unitCaptureAtMs.length) this.stepCapture.set(s.lastChunk, Math.max(...st.unitCaptureAtMs));
    });
    src.on("level", (e) => this.set({ level: e.rms }));
    src.on("vad", (e) => this.set(e.speech ? { speaking: true } : { speaking: false, quietSince: Date.now() }));
    src.on("state", (e) => this.set({ behind: e.state === "behind" }));
    src.on("error", (e) => {
      if (e.code === "model_missing") return;
      this.set({ message: e.message, ...(e.code.startsWith("mic") ? { phase: "ready" as Phase } : {}) });
    });
  }

  private onChunk(c: ChunkEvent, symbols: string[]) {
    const s = this.stats;
    const arrival = performance.timeOrigin + performance.now();
    if (s.lastChunk >= 0 && c.chunk !== s.lastChunk + 1) s.gaps++;
    s.lastChunk = c.chunk;
    s.steps++;
    if (c.captureAtMs < c.emittedAtMs) s.latency.push(arrival - c.captureAtMs);
    this.engine?.postMessage({ type: "step", step: c.chunk, units: c.units.map((u) => u.id), frames: c.units.map((u) => u.frame), time: (c.chunk + 1) * STEP_S });
    if (c.units.length) {
      const raw = this.s.raw.slice();
      for (const u of c.units) {
        const last = raw[raw.length - 1];
        const lastFrame = last?.units[last.units.length - 1]?.frame;
        if (!last || lastFrame === undefined || u.frame - lastFrame > LINE_GAP_FRAMES) raw.push({ units: [u], text: symbols[u.id] ?? "" });
        else raw[raw.length - 1] = { units: [...last.units, u], text: last.text + (symbols[u.id] ?? "") };
      }
      this.set({ raw });
    }
    this.set({ statsVersion: this.s.statsVersion + 1 });
  }

  private onEngine(m: FromEngine) {
    if (m.type === "ready") {
      this.stats.engineLoadMs = m.ms;
      return this.set({ engineReady: true });
    }
    if (m.type === "error") {
      if (this.verified) this.set({ verify: { ...this.s.verify, status: "error", error: m.message } });
      return this.set({ message: `Voice engine: ${m.message}` });
    }
    if (m.type === "verified") {
      this.verified?.(m.result);
      this.verified = null;
      return;
    }
    this.stats.engineMs.push(m.ms);
    if (!m.events.length) return;
    this.engineLog.push({ step: m.step, events: m.events });
    const arrival = performance.timeOrigin + performance.now();
    let paragraphs = this.s.paragraphs;
    const patch: Partial<VoiceState> = {};
    const openParagraph = () => {
      const last = paragraphs[paragraphs.length - 1];
      if (last && !last.closed) return last;
      const p: Paragraph = { id: ++this.paragraphId, items: [], ayahEnd: null, closed: false };
      paragraphs = [...paragraphs, p];
      return p;
    };
    const replaceLast = (p: Paragraph) => (paragraphs = [...paragraphs.slice(0, -1), p]);
    for (const e of m.events) {
      switch (e.type) {
        case "located":
          patch.tracking = true;
          patch.pendingLetters = 0;
          break;
        case "lost":
          patch.tracking = false;
          break;
        case "cursor": {
          patch.cursor = e.keys![0];
          const captured = this.stepCapture.get(m.step);
          if (captured) this.stats.cursorLag.push(arrival - captured);
          break;
        }
        case "heard": {
          const p = openParagraph();
          const items = e.words.map((w, i) => ({ key: e.keys![i], status: w.status }));
          replaceLast({ ...p, items: [...p.items, ...items] });
          patch.last = items[items.length - 1].key;
          break;
        }
        case "ayahComplete": {
          const p = openParagraph();
          replaceLast({ ...p, ayahEnd: e.ayah, closed: true });
          break;
        }
        case "candidates":
          patch.candidates = e.places.map((pl, i) => ({ key: e.keys![i], score: pl.score }));
          break;
        case "pending":
          patch.pendingLetters = e.letters;
          break;
      }
    }
    this.set({ ...patch, paragraphs });
  }

  private resetRun() {
    const engineLoadMs = this.stats.engineLoadMs;
    this.stats = emptyStats();
    this.stats.engineLoadMs = engineLoadMs;
    this.stepCapture.clear();
    this.engineLog.length = 0;
    this.engine?.postMessage({ type: "reset" });
    this.set({ message: null, speaking: false, quietSince: Date.now(), tracking: false, cursor: null, candidates: [], pendingLetters: 0 });
  }

  private beginMode(mode: Mode) {
    this.set({
      mode,
      verify: mode === "verify" ? { status: "recording", result: null, startedAt: Date.now() } : { status: "idle", result: null, startedAt: null },
    });
  }

  /**
   * Start listening. Call from a tap (the AudioContext must be created inside it). In verify mode the same
   * follow-along runs live; the check happens on stop (spec §7.6).
   */
  async start(mode: Mode = "follow") {
    const src = this.source;
    if (!src || this.state.phase !== "ready") return;
    this.resetRun();
    this.beginMode(mode);
    try {
      const pending = src.start();
      this.set({ phase: "listening" }, true);
      await pending;
      this.wakeLock = (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;
      if (mode === "verify") this.verifyTimer = setTimeout(() => void this.stop(), VERIFY_MAX_MINUTES * 60_000);
    } catch {
      this.set({ phase: "ready", verify: { status: "idle", result: null, startedAt: null } }, true);
    }
  }

  async stop() {
    const src = this.source;
    if (!src || this.state.phase !== "listening") return;
    if (this.verifyTimer) clearTimeout(this.verifyTimer);
    this.verifyTimer = null;
    this.set({ phase: "stopping" }, true);
    await src.stop();
    await this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.set({ level: 0 });
    if (this.state.mode === "verify") await this.check();
    this.set({ phase: "ready" }, true);
  }

  /** Verify mode's check (spec §7.6): the whole recording, against the passage the reciter recited. */
  private async check() {
    const src = this.source;
    if (!src || !this.engine) return;
    this.set({ phase: "verifying", verify: { ...this.s.verify, status: "checking" } }, true);
    try {
      await this.engineIdle(); // every step followed first: the passage comes from where the cursor went
      const lp = await src.logProbs();
      const result = await new Promise<VerifyResult>((resolve) => {
        this.verified = resolve;
        this.engine!.postMessage({ type: "verify", logprobs: lp.data, vocab: lp.vocab, blank: lp.blank, frameS: 0.04 }, [lp.data.buffer]);
      });
      this.set({ verify: { ...this.s.verify, status: "done", result } }, true);
    } catch (e) {
      this.set({ verify: { ...this.s.verify, status: "error", error: e instanceof Error ? e.message : String(e) } }, true);
    }
  }

  /** Clears verify results (e.g. when the results panel is closed). */
  dismissResults() {
    this.set({ mode: "follow", verify: { status: "idle", result: null, startedAt: null } }, true);
  }

  /** Runs an audio file through the same pipeline and engine, as fast as the device allows (and checks it). */
  async transcribeFile(file: File, mode: Mode = "follow") {
    const src = this.source;
    if (!src || this.state.phase !== "ready") return;
    this.resetRun();
    this.beginMode(mode);
    this.set({ phase: "stopping" }, true);
    try {
      // decoded straight to 16 kHz by the browser; the worker's resampler then passes it through unchanged
      const ctx = new OfflineAudioContext(1, 1, 16000);
      const audio = await ctx.decodeAudioData(await file.arrayBuffer());
      const mono = new Float32Array(audio.length);
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const ch = audio.getChannelData(c);
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
      }
      await src.transcribe(mono, audio.sampleRate);
      await this.engineIdle();
      if (mode === "verify") await this.check();
    } catch (e) {
      this.set({ message: `Couldn't read that file: ${e instanceof Error ? e.message : e}` });
    }
    this.set({ phase: "ready" }, true);
  }

  /** Resolves when the engine has answered every step sent so far. */
  private engineIdle(): Promise<void> {
    const target = this.stats.lastChunk;
    return new Promise((resolve) => {
      const check = () => {
        const done = this.stats.engineMs.length >= this.stats.steps || target < 0;
        if (done) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
  }

  clear() {
    this.set({ paragraphs: [], raw: [], last: null, cursor: null, candidates: [], pendingLetters: 0 }, true);
  }
}
