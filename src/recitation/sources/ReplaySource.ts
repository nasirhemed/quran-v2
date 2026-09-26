/**
 * Plays a recorded fixture (model output, no audio) as if it were the live recognizer: one ChunkEvent per model
 * step, at the original pace or faster (spec §8.7). Used by tests, and in development with `?replay=` (M4).
 */
import type { LogProbs } from "../engine/ctc";
import { Emitter, type RecognizerSource } from "./RecognizerSource";

export interface ReplayFixture {
  frameMs: number;
  stepFrames: number;
  frames: number;
  units: [number, number][]; // [unit id, output frame]
  logprobs: LogProbs;
}

export class ReplaySource extends Emitter implements RecognizerSource {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private done: Promise<void> = Promise.resolve();

  /** `speed`: 1 = real time; Infinity = as fast as possible (tests). */
  constructor(private readonly fx: ReplayFixture, private readonly speed = 1) {
    super();
  }

  async start() {
    const session = `replay-${Date.now()}`;
    const steps = Math.ceil(this.fx.frames / this.fx.stepFrames);
    const byStep: { id: number; frame: number }[][] = Array.from({ length: steps }, () => []);
    for (const [id, frame] of this.fx.units) byStep[Math.floor(frame / this.fx.stepFrames)].push({ id, frame });
    const stepMs = this.fx.stepFrames * this.fx.frameMs;
    this.emit("state", { state: "listening" });
    this.done = new Promise((resolve) => {
      let chunk = 0;
      const tick = () => {
        const audioEndFrame = Math.min(this.fx.frames, (chunk + 1) * this.fx.stepFrames) - 1;
        const t = (chunk + 1) * stepMs;
        this.emit("chunk", { session, chunk, units: byStep[chunk], audioEndFrame, emittedAtMs: t, captureAtMs: t });
        chunk++;
        if (chunk >= steps) {
          this.timer = null;
          this.emit("state", { state: "idle" });
          resolve();
        } else if (Number.isFinite(this.speed)) this.timer = setTimeout(tick, stepMs / this.speed);
        else tick();
      };
      tick();
    });
    return { session };
  }

  /** Resolves when every step has been emitted. */
  finished() {
    return this.done;
  }

  async stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.emit("state", { state: "idle" });
  }

  async logProbs() {
    return this.fx.logprobs;
  }
}
