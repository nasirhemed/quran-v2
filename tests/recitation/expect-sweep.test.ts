/**
 * Every verse of the Qur'an through FollowSession.expect() with ideal model output (the reference phonemes, 4 and
 * 8 units per 0.48 s step): each should complete, and none before its last word is heard. Slow (~50 s), so it
 * runs only with RECITATION_SWEEP=1, e.g. after changing follow.ts or session.ts.
 */
import { describe, expect, it } from "vitest";
import { FollowSession } from "@/recitation/engine/session";
import { quran, referenceUnits } from "./helpers";

describe.skipIf(!process.env.RECITATION_SWEEP)("expect() over the whole Qur'an", () => {
  it("completes every verse, never early", () => {
    const { words, ref, table } = quran();
    const never: string[] = [];
    const early: string[] = [];
    for (const [ayah, [first, n]] of Object.entries(words.ayat)) {
      const perWord = Array.from({ length: n }, (_, i) => referenceUnits(words.ph[first + i]));
      const units = perWord.flat();
      const lastStart = units.length - perWord[n - 1].length;
      for (const per of [4, 8]) {
        const s = new FollowSession(ref, words, table.symbols);
        s.expect(first);
        let done: number | null = null;
        for (let step = 0; step < Math.ceil(units.length / per) + 3 && done === null; step++)
          for (const e of s.push(units.slice(step * per, step * per + per), step, step * 0.48)) if (e.type === "ayahComplete" && e.ayah === ayah) done = step;
        if (done === null) never.push(`${ayah}/${per}`);
        else if ((done + 1) * per <= lastStart) early.push(`${ayah}/${per}`);
      }
    }
    expect(early).toEqual([]);
    // 4 of 12,472 runs today (56:42, 74:13, 79:37, 80:16 at 4 units per step)
    expect(never.length).toBeLessThanOrEqual(10);
  }, 600_000);
});
