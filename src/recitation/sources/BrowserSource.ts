/**
 * The live recognizer in the browser (spec §10.7): microphone → AudioWorklet → shared ring buffer → ASR worker.
 * Also transcribes audio files through the same worker and pipeline (for testing and for trying recordings).
 */
import type { ModelPack } from "../asr/modelPack";
import { createRing } from "../asr/ring";
import type { LogProbs } from "../engine/ctc";
import type { FromWorker, ToWorker } from "../workers/protocol";
import workletUrl from "../workers/capture.worklet.ts?worker&url";
import { Emitter, type RecognizerSource } from "./RecognizerSource";

export interface StepStats {
  inferMs: number;
  stepAudioMs: number;
  backlogMs: number;
  /** when each new unit's audio was captured (epoch ms); empty for files */
  unitCaptureAtMs: number[];
  /** how far the audio clock has drifted from ours since the start (ms) */
  clockDriftMs: number;
}

export interface Loaded {
  symbols: string[];
  loadMs: number;
  threads: number;
  packId: string;
}

export class BrowserSource extends Emitter implements RecognizerSource {
  private worker: Worker;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  /** false when the caller passed its own stream to start(): then the caller stops it, not us */
  private ownsStream = true;
  private onTrackEnded: (() => void) | null = null;
  private nodes: AudioNode[] = [];
  private waiters = new Map<string, ((m: FromWorker) => void)[]>();
  private stepListeners = new Set<(s: StepStats) => void>();

  constructor() {
    super();
    this.worker = new Worker(new URL("../workers/asr.worker.ts", import.meta.url), { type: "module", name: "itqan-asr" });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const m = e.data;
      if (m.type === "event") this.emit(m.name, m.payload as never);
      else if (m.type === "step") this.stepListeners.forEach((cb) => cb(m));
      const list = this.waiters.get(m.type);
      if (list?.length) list.shift()!(m);
    };
    this.worker.onerror = (e) => this.emit("error", { code: "worker", message: e.message || "The speech worker failed to start" });
  }

  private send(m: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(m, transfer);
  }

  private next<T extends FromWorker["type"]>(type: T): Promise<Extract<FromWorker, { type: T }>> {
    return new Promise((resolve) => {
      const list = this.waiters.get(type) ?? [];
      list.push(resolve as (m: FromWorker) => void);
      this.waiters.set(type, list);
    });
  }

  onStep(cb: (s: StepStats) => void): () => void {
    this.stepListeners.add(cb);
    return () => this.stepListeners.delete(cb);
  }

  /** Loads the pack's model from on-device storage into the worker. Resolves null if it isn't downloaded. */
  async load(pack: ModelPack, threads = 2): Promise<Loaded | null> {
    const loaded = this.next("loaded");
    const missing = new Promise<null>((resolve) => {
      const off = this.on("error", (e) => {
        if (e.code === "model_missing") {
          off();
          resolve(null);
        }
      });
    });
    this.send({ type: "load", packId: pack.id, threads });
    return Promise.race([loaded, missing]);
  }

  /**
   * Starts listening to the microphone. Call from a tap: the AudioContext is created before any await so the
   * browser counts it as user-initiated. With `stream`, listens to that (a mic the caller already opened, e.g.
   * the memorisation prototype's chosen mic) and leaves stopping it to the caller.
   */
  async start(stream?: MediaStream): Promise<{ session: string }> {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const session = `mic-${Date.now()}`;
    this.ownsStream = !stream;
    try {
      this.stream =
        stream ??
        (await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        }));
    } catch (e) {
      await this.teardown();
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      this.emit("error", { code: denied ? "mic_denied" : "mic_unavailable", message: denied ? "Microphone permission needed" : "No microphone available" });
      throw e;
    }
    // a caller's own stream is the caller's to watch (it may be reused across many starts)
    if (this.ownsStream) {
      this.onTrackEnded = () => {
        this.emit("error", { code: "mic_ended", message: "The microphone was disconnected" });
        void this.stop();
      };
      this.stream.getAudioTracks()[0]?.addEventListener("ended", this.onTrackEnded);
    }
    await ctx.resume();
    await ctx.audioWorklet.addModule(workletUrl);
    const ring = createRing();
    const src = ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(ctx, "itqan-capture", { processorOptions: ring, numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
    const mute = ctx.createGain();
    mute.gain.value = 0; // the node must reach the destination to be scheduled; nothing is played
    src.connect(node).connect(mute).connect(ctx.destination);
    this.nodes = [src, node, mute];
    const ts = ctx.getOutputTimestamp();
    const epochAtContextZero = performance.timeOrigin + (ts.performanceTime ?? performance.now()) - (ts.contextTime ?? ctx.currentTime) * 1000;
    this.send({ type: "start", session, ring, sampleRate: ctx.sampleRate, epochAtContextZero });
    return { session };
  }

  /** Transcribes decoded audio (any sample rate) through the same pipeline, as fast as the device allows. */
  async transcribe(samples: Float32Array, sampleRate: number): Promise<{ session: string }> {
    const session = `file-${Date.now()}`;
    this.send({ type: "startFeed", session, sampleRate });
    const piece = sampleRate; // 1 s per message
    for (let i = 0; i < samples.length; i += piece) {
      const part = samples.slice(i, i + piece);
      this.send({ type: "feed", samples: part }, [part.buffer]);
    }
    await this.stop();
    return { session };
  }

  async stop(): Promise<void> {
    await this.teardown();
    const done = this.next("stopped");
    this.send({ type: "stop" });
    await done;
  }

  private async teardown() {
    if (this.onTrackEnded) this.stream?.getAudioTracks()[0]?.removeEventListener("ended", this.onTrackEnded);
    this.onTrackEnded = null;
    if (this.ownsStream) this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.nodes.forEach((n) => n.disconnect());
    this.nodes = [];
    if (this.ctx && this.ctx.state !== "closed") await this.ctx.close();
    this.ctx = null;
  }

  async logProbs(): Promise<LogProbs> {
    const reply = this.next("logProbs");
    this.send({ type: "logProbs" });
    const m = await reply;
    return { data: m.data, vocab: m.vocab, blank: m.blank };
  }

  dispose() {
    void this.teardown();
    this.worker.terminate();
  }
}
