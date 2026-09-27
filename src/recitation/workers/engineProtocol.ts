/** Messages between the main thread and the engine worker. Words go out with their "s:a:w" key. */
import type { EngineEvent } from "../engine/session";
import type { MistakeKind } from "../engine/verify";

export type ToEngine =
  | { type: "init"; symbols: string[] }
  | { type: "reset" }
  /** one model step's new units with their output frames; `time` is the step's audio time in seconds */
  | { type: "step"; step: number; units: number[]; frames: number[]; time: number }
  /** verify mode, after stop: check the whole recording against the recited passage */
  | { type: "verify"; logprobs: Float32Array; vocab: number; blank: number; frameS: number };

/** An EngineEvent with word keys added for the UI. */
export type KeyedEvent = EngineEvent & { keys?: string[] };

/** A confirmed mistake, with word keys ("s:a:w") for the UI. */
export interface VerifyFinding {
  kind: MistakeKind;
  keys: string[];
  /** seconds into the recording */
  time: number;
  ayah?: string;
  /** MUTASHABIH_SLIP: where the reciter should have been */
  expected?: string;
}

export interface VerifyResult {
  /** the recited passage checked, "s:a" to "s:a"; null when too little was followed to know */
  from: string | null;
  to: string | null;
  /** every ayah in the passage, in order */
  ayat: string[];
  findings: VerifyFinding[];
  /** candidates the log-probs did not confirm (dropped: false alarms are worse than misses) */
  cleared: number;
  ms: number;
}

export type FromEngine =
  | { type: "ready"; ms: number; words: number }
  | { type: "events"; step: number; events: KeyedEvent[]; ms: number }
  | { type: "verified"; result: VerifyResult }
  | { type: "error"; message: string };
