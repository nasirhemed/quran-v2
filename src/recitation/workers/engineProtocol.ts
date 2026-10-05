/** Messages between the main thread and the engine worker. Words go out with their "s:a:w" key. */
import type { EngineEvent } from "../engine/session";

export type ToEngine =
  | { type: "init"; symbols: string[] }
  | { type: "reset" }
  /** a fresh session that follows from the first word of ayah "s:a" (no voice search) */
  | { type: "expect"; ayah: string }
  /** one model step's new units; `time` is the step's audio time in seconds */
  | { type: "step"; step: number; units: number[]; time: number };

/** An EngineEvent with word keys added for the UI. */
export type KeyedEvent = EngineEvent & { keys?: string[] };

export type FromEngine =
  | { type: "ready"; ms: number; words: number }
  | { type: "events"; step: number; events: KeyedEvent[]; ms: number }
  | { type: "error"; message: string };
