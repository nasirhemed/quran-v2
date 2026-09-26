/** Messages between BrowserSource (main thread) and the ASR worker. */
import type { RingBuffers } from "../asr/ring";
import type { SourceEvents } from "../sources/RecognizerSource";

export type ToWorker =
  | { type: "load"; packId: string; threads: number }
  /** live microphone: audio arrives through the shared ring buffer */
  | { type: "start"; session: string; ring: RingBuffers; sampleRate: number; epochAtContextZero: number }
  /** an audio file or test input: samples arrive by `feed` messages */
  | { type: "startFeed"; session: string; sampleRate: number }
  | { type: "feed"; samples: Float32Array }
  | { type: "stop" }
  | { type: "logProbs" };

export type FromWorker =
  | { type: "loaded"; symbols: string[]; loadMs: number; threads: number; packId: string }
  | { type: "event"; name: keyof SourceEvents; payload: SourceEvents[keyof SourceEvents] }
  /** per-step timing; `unitCaptureAtMs` is empty for fed audio (no capture clock) */
  | { type: "step"; inferMs: number; stepAudioMs: number; backlogMs: number; unitCaptureAtMs: number[] }
  | { type: "stopped" }
  | { type: "logProbs"; data: Float32Array; vocab: number; blank: number };
