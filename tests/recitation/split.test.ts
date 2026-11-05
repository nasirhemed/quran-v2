/**
 * Splitting a long recitation into ayahs (engine/split.ts), on a track made of three golden clips back to back:
 * the basmala (1:1), 112:1 and the first 12 s of 2:255, with a pause between them. Uses the clips' recorded
 * model B output, so it needs no model.
 */
import { describe, expect, it } from "vitest";
import { levelOf, splitAyahs } from "@/recitation/engine/split";
import type { HeardUnit } from "@/recitation/engine/verify";
import { golden, quran } from "./helpers";

const RATE = 16000;
const FRAME_S = 0.04;

function track(names: string[], gapS: number[], noise = 0.0005) {
  const parts: Float32Array[] = [];
  const heard: HeardUnit[] = [];
  const starts: number[] = [];
  let at = 0;
  let seed = 1;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2 * noise;
  names.forEach((name, i) => {
    const gap = new Float32Array(Math.round(gapS[i] * RATE)).map(rand);
    parts.push(gap);
    at += gap.length;
    const { meta, audio } = golden(name);
    starts.push(at / RATE);
    for (const [unit, frame] of meta.units) heard.push({ unit, time: at / RATE + frame * FRAME_S });
    parts.push(audio);
    at += audio.length;
  });
  parts.push(new Float32Array(RATE * 2).map(rand));
  at += RATE * 2;
  const audio = new Float32Array(at);
  let o = 0;
  for (const p of parts) {
    audio.set(p, o);
    o += p.length;
  }
  return { audio, heard, starts };
}

describe("split a recitation into ayahs", () => {
  it("cuts in the pauses between ayat", () => {
    const { words, table } = quran();
    const { audio, heard, starts } = track(["husary-1-1", "husary-112-1", "husary-2-255-12s"], [1.0, 0.8, 1.2]);
    const level = levelOf(audio, RATE);
    // where each clip's sound starts (the clips have their own lead-in)
    const loud = Math.max(...level.db) - 30;
    const onsets = starts.map((t) => {
      let f = Math.round(t / level.frameS);
      while (level.db[f] < loud) f++;
      return f * level.frameS;
    });
    const spans = splitAyahs(heard, words, table, ["112:1", "2:255"], level, { basmala: true });
    expect(spans.map((s) => s.ayah)).toEqual(["basmala", "112:1", "2:255"]);
    // each clip starts just before its ayah's sound and ends before the next one starts
    onsets.forEach((t, i) => {
      expect(spans[i].start).toBeLessThanOrEqual(t);
      expect(spans[i].start).toBeGreaterThan(t - 0.5);
      if (i > 0) {
        expect(spans[i - 1].end).toBeLessThan(spans[i].start + 1e-9);
        expect(spans[i].cut).toBe("pause");
      }
    });
    expect(spans[0].heard).toBe(1);
    expect(spans[1].heard).toBe(1); // 2:255 is cut short at 12 s
  });

  it("joined ayat (no pause) still get a cut between them", () => {
    const { words, table } = quran();
    const { audio, heard, starts } = track(["husary-1-1", "husary-112-1"], [0.5, 0]);
    const spans = splitAyahs(heard, words, table, ["112:1"], levelOf(audio, RATE), { basmala: true });
    expect(spans[1].start).toBeGreaterThan(starts[1] - 1.5);
    expect(spans[1].start).toBeLessThan(starts[1] + 0.8);
  });

  it("leaves the basmala out when the recording doesn't have it", () => {
    const { words, table } = quran();
    const { audio, heard } = track(["husary-112-1"], [0.5]);
    const spans = splitAyahs(heard, words, table, ["112:1"], levelOf(audio, RATE), { basmala: true });
    expect(spans.map((s) => s.ayah)).toEqual(["112:1"]);
    expect(spans[0].heard).toBe(1);
  });
});
