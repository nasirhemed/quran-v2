import fs from "node:fs";
import path from "node:path";
import { type LogProbs } from "@/recitation/engine/ctc";
import { type RecitationWords, type UnitTable } from "@/recitation/engine/data";
import { Follower, type FollowEvent } from "@/recitation/engine/follow";
import { Reference } from "@/recitation/engine/reference";

const root = path.resolve(__dirname, "../..");
export const FIXTURES = path.join(root, "tests/fixtures/recitation");
export const PRIVATE_FIXTURES = path.resolve(root, process.env.RECITATION_PRIVATE_FIXTURES ?? "../../recordings");

let cached: { words: RecitationWords; ref: Reference; table: UnitTable } | null = null;
/** recitation-words.json, the whole-Quran reference (built once per test file) and model B's symbol table. */
export function quran() {
  if (!cached) {
    const words: RecitationWords = JSON.parse(fs.readFileSync(path.join(root, "public/data/recitation-words.json"), "utf8"));
    const table: UnitTable = JSON.parse(fs.readFileSync(path.join(FIXTURES, "zipformer-p-arabic-v3.symbols.json"), "utf8"));
    cached = { words, ref: new Reference(words), table };
  }
  return cached;
}

export interface Fixture {
  name: string;
  passage: [string, string];
  frameMs: number;
  stepFrames: number;
  frames: number;
  vocab: number;
  blank: number;
  logprobs: { file: string; nats_per_step: number };
  units: [number, number][];
  expected: {
    follow: { type: string; word: string; at: number }[];
    verify: { kind: string; words: string[]; time: number; expected?: string }[];
  };
}

export function loadFixture(dir: string, name: string): { fx: Fixture; lp: LogProbs } {
  const fx: Fixture = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
  const q = fs.readFileSync(path.join(dir, fx.logprobs.file));
  const data = new Float32Array(q.length);
  for (let i = 0; i < q.length; i++) data[i] = -q[i] * fx.logprobs.nats_per_step;
  return { fx, lp: { data, vocab: fx.vocab, blank: fx.blank } };
}

/** Replay a fixture through the follow-mode tracker one 0.48 s model step at a time, like the live pipeline. */
export function replayFollow(fx: Fixture) {
  const { ref, table } = quran();
  const f = new Follower(ref);
  const steps = new Map<number, string>();
  for (const [u, frame] of fx.units) {
    const step = Math.floor(frame / fx.stepFrames);
    steps.set(step, (steps.get(step) ?? "") + table.symbols[u]);
  }
  const passed = new Map<number, number>(); // word idx → time the cursor passed it
  for (const step of [...steps.keys()].sort((a, b) => a - b)) {
    const now = ((step + 1) * fx.stepFrames * fx.frameMs) / 1000;
    const before = f.cursor;
    f.push(steps.get(step)!, now);
    if (f.state === "TRACKING" && f.cursor !== null && f.cursor !== before) {
      for (let w = (before ?? f.cursor) - 30; w < f.cursor; w++) if (w >= 0 && !passed.has(w)) passed.set(w, now);
    }
  }
  return { follower: f, events: f.events as FollowEvent[], passed };
}

export const heardUnits = (fx: Fixture) => fx.units.map(([unit, frame]) => ({ unit, time: (frame * fx.frameMs) / 1000 }));
