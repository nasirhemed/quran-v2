/**
 * The one interface the UI and engine see for recognition (spec §10.7): the live browser pipeline (M3), a
 * replay of recorded model output (ReplaySource), or a native plugin (Plan B).
 */
import type { LogProbs } from "../engine/ctc";

/** One model step's output (spec §8.4). Exactly one per step, even when nothing new was decoded. */
export interface ChunkEvent {
  session: string;
  chunk: number; // +1 per step; a gap means a dropped step
  units: { id: number; frame: number }[]; // CTC-collapsed units first emitted in this step
  audioEndFrame: number;
  emittedAtMs: number;
  captureAtMs: number;
}

export interface SourceEvents {
  chunk: ChunkEvent;
  vad: { speech: boolean; atFrame: number };
  level: { rms: number };
  state: { state: "idle" | "loading" | "listening" | "behind" | "stopping"; reason?: string };
  error: { code: string; message: string };
  downloadProgress: { bytes: number; total: number };
}

export interface RecognizerSource {
  start(): Promise<{ session: string }>;
  stop(): Promise<void>; // flushes first
  /**
   * The whole session's per-frame log-probs, for verify mode's confirmation step (spec v1.3 §7.6). Deviation from
   * §10.7's per-window scoreWindow(): verify checks the whole recording once, after it stops.
   */
  logProbs(): Promise<LogProbs>;
  on<E extends keyof SourceEvents>(event: E, cb: (e: SourceEvents[E]) => void): () => void;
}

/** Minimal typed event emitter shared by sources. */
export class Emitter {
  private handlers = new Map<string, Set<(e: never) => void>>();
  on<E extends keyof SourceEvents>(event: E, cb: (e: SourceEvents[E]) => void): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(cb as (e: never) => void);
    this.handlers.set(event, set);
    return () => set.delete(cb as (e: never) => void);
  }
  emit<E extends keyof SourceEvents>(event: E, e: SourceEvents[E]) {
    this.handlers.get(event)?.forEach((cb) => (cb as (x: SourceEvents[E]) => void)(e));
  }
}
