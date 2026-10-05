/**
 * The speech model for the memorisation prototype: knows when you have finished the verse instead of guessing
 * from silence. The same pieces as the app's voice session (BrowserSource → ASR worker, engine worker), but run
 * only during your turn, on the mic the prototype already opened, and told which verse you are about to recite
 * (the engine follows it from its first word: no voice search, so a verse that opens like another is no
 * problem). Nothing the reciter says is ever heard: listening starts with your turn and stops with it.
 */
import { selectedPack } from "@/recitation/asr/modelPack";
import { ModelStore, OpfsFileStore } from "@/recitation/asr/modelStore";
import { BrowserSource } from "@/recitation/sources/BrowserSource";
import type { ChunkEvent } from "@/recitation/sources/RecognizerSource";
import { getVoiceSupport } from "@/recitation/support";
import type { FromEngine, KeyedEvent } from "@/recitation/workers/engineProtocol";

export type ModelAvailability = { state: "ready" } | { state: "no-model" } | { state: "unsupported"; missing: string[] };

/** Can the speech model run here, and is it downloaded? Cheap: reads the stored files' sizes and hashes. */
export async function modelAvailability(): Promise<ModelAvailability> {
  const support = getVoiceSupport();
  if (!support.supported) return { state: "unsupported", missing: support.missing };
  const status = await new ModelStore(new OpfsFileStore()).status(selectedPack());
  return status.state === "ready" ? { state: "ready" } : { state: "no-model" };
}

export interface RecognizerHandlers {
  /** words heard, "s:a:w", in order */
  heard(keys: string[]): void;
  /** the verse (or another one, after a slip) was recited to its last word */
  ayahComplete(ayah: string): void;
  /** for the log: the engine lost its place, or found one */
  note(text: string): void;
}

const STEP_S = 0.48;

export class LabRecognizer {
  private source: BrowserSource | null = null;
  private engine: Worker | null = null;
  private active = false;
  /** resolves when the last turn's listening has fully stopped (its final audio flushed) */
  private idle: Promise<void> = Promise.resolve();
  loadMs = NaN;

  constructor(private handlers: RecognizerHandlers) {}

  /** Loads the model and the Quran index (a few seconds). Rejects if it can't. */
  async load(): Promise<void> {
    const t0 = performance.now();
    const src = new BrowserSource();
    this.source = src;
    const loaded = await src.load(selectedPack(), 2);
    if (!loaded) throw new Error("the speech model isn't downloaded");
    src.on("chunk", (c: ChunkEvent) => {
      if (this.active) this.engine?.postMessage({ type: "step", step: c.chunk, units: c.units.map((u) => u.id), time: (c.chunk + 1) * STEP_S });
    });
    src.on("error", (e) => this.handlers.note(`speech model: ${e.message}`));
    src.on("state", (e) => {
      if (e.state === "behind") this.handlers.note("speech model: can't keep up on this device");
    });
    const engine = new Worker(new URL("../recitation/workers/engine.worker.ts", import.meta.url), { type: "module", name: "itqan-lab-engine" });
    this.engine = engine;
    await new Promise<void>((resolve, reject) => {
      engine.onmessage = (e: MessageEvent<FromEngine>) => {
        const m = e.data;
        if (m.type === "ready") resolve();
        else if (m.type === "error") reject(new Error(m.message));
        else if (m.type === "events" && this.active) this.onEvents(m.events);
      };
      engine.onerror = (e) => reject(new Error(e.message || "the engine worker failed to start"));
      engine.postMessage({ type: "init", symbols: loaded.symbols });
    });
    engine.onmessage = (e: MessageEvent<FromEngine>) => {
      const m = e.data;
      if (m.type === "events" && this.active) this.onEvents(m.events);
      else if (m.type === "error") this.handlers.note(`speech model: ${m.message}`);
    };
    this.loadMs = performance.now() - t0;
  }

  /** Starts listening to `stream` for ayah "s:a". */
  async begin(stream: MediaStream, ayah: string): Promise<void> {
    const src = this.source;
    if (!src || !this.engine) return;
    await this.idle;
    this.engine.postMessage({ type: "expect", ayah });
    this.active = true;
    await src.start(stream);
  }

  /** Stops listening. Events from the audio still being flushed are dropped. */
  end() {
    if (!this.active) return;
    this.active = false;
    this.idle = this.source?.stop().catch(() => undefined) ?? Promise.resolve();
  }

  dispose() {
    this.active = false;
    this.source?.dispose();
    this.engine?.terminate();
    this.source = null;
    this.engine = null;
  }

  private onEvents(events: KeyedEvent[]) {
    for (const e of events) {
      if (e.type === "heard" && e.keys?.length) this.handlers.heard(e.keys);
      else if (e.type === "ayahComplete") this.handlers.ayahComplete(e.ayah);
      else if (e.type === "lost") this.handlers.note(`speech model lost the place after ${e.keys?.[0] ?? "?"}`);
      else if (e.type === "located") this.handlers.note(`speech model found the place again at ${e.keys?.[0] ?? "?"}`);
    }
  }
}
