/**
 * FollowSession: the follow-mode events the screen uses (heard words, cursor, ayah breaks, voice search),
 * replayed from the public fixtures (model B's real output for Husary 2:255, clean / skip / slip).
 */
import { describe, expect, it } from "vitest";
import { passageWords, wordIndex } from "@/recitation/engine/data";
import { FollowSession, type EngineEvent } from "@/recitation/engine/session";
import { verify } from "@/recitation/engine/verify";
import { FIXTURES, loadFixture, quran, type Fixture } from "./helpers";

function run(fx: Fixture) {
  const { words, ref, table } = quran();
  const s = new FollowSession(ref, words, table.symbols);
  const byStep = new Map<number, number[]>();
  for (const [u, frame] of fx.units) {
    const step = Math.floor(frame / fx.stepFrames);
    byStep.set(step, [...(byStep.get(step) ?? []), u]);
  }
  const events: EngineEvent[] = [];
  const steps = Math.ceil(fx.frames / fx.stepFrames);
  for (let step = 0; step < steps; step++) events.push(...s.push(byStep.get(step) ?? [], step, ((step + 1) * fx.stepFrames * fx.frameMs) / 1000));
  const key = wordIndex(words).key;
  const heard = events.flatMap((e) => (e.type === "heard" ? e.words.map((w) => ({ key: key[w.idx], status: w.status })) : []));
  return { events, heard, key, words };
}

describe("follow session", () => {
  it("clean 2:255: the transcript is the ayah's words, in order, then one ayah break", () => {
    const { fx } = loadFixture(FIXTURES, "husary-2-255-clean");
    const { events, heard, words, key } = run(fx);
    const passage = passageWords(words, "2:255", "2:255").map((w) => key[w]);
    const matched = heard.filter((h) => h.status === "match").map((h) => h.key);
    expect(matched.every((k) => k.startsWith("2:255:"))).toBe(true);
    // in order, no word twice
    expect(new Set(matched).size).toBe(matched.length);
    expect(matched.map((k) => passage.indexOf(k))).toEqual([...matched.map((k) => passage.indexOf(k))].sort((a, b) => a - b));
    expect(matched.length / passage.length).toBeGreaterThanOrEqual(0.95);
    expect(events.filter((e) => e.type === "ayahComplete").map((e) => (e as { ayah: string }).ayah)).toEqual(["2:255"]);
    // the ambiguous opening (shared with 3:2) is filled in once the place is confirmed
    expect(matched[0]).toBe("2:255:1");
  });

  it("voice search: while 2:255's opening (shared with 3:2) is ambiguous, both places are offered", () => {
    const { fx } = loadFixture(FIXTURES, "husary-2-255-clean");
    const { events, key } = run(fx);
    const firstLock = events.findIndex((e) => e.type === "located");
    const offered = events.slice(0, firstLock).flatMap((e) => (e.type === "candidates" ? e.places.map((p) => key[p.word]) : []));
    expect(offered.some((k) => k.startsWith("2:255:"))).toBe(true);
    expect(offered.some((k) => k.startsWith("3:2:"))).toBe(true);
    // cleared once located
    const after = events.slice(firstLock).find((e) => e.type === "candidates");
    expect(after && after.type === "candidates" && after.places.length).toBe(0);
  });

  it("skip: the cursor moves on after the skipped words", () => {
    const { fx } = loadFixture(FIXTURES, "husary-2-255-skip");
    const { events, key, heard } = run(fx);
    const idx = new Map(key.map((k, i) => [k, i]));
    const cursors = events.filter((e) => e.type === "cursor").map((e) => (e as { word: number }).word);
    // words 17–19 were cut: the cursor goes on past them, and the transcript carries on after the gap
    expect(Math.max(...cursors)).toBeGreaterThan(idx.get("2:255:25")!);
    expect(heard.some((h) => h.key === "2:255:20")).toBe(true);
    expect(heard.some((h) => h.key === "2:255:30")).toBe(true);
  });

  it("slip into 3:3 and back: the transcript follows, and 2:255 resumes", () => {
    const { fx } = loadFixture(FIXTURES, "husary-2-255-slip");
    const { heard } = run(fx);
    const keys = heard.map((h) => h.key);
    expect(keys.some((k) => k.startsWith("3:3:"))).toBe(true);
    const back = keys.length - 1 - [...keys].reverse().findIndex((k) => k.startsWith("3:"));
    expect(keys.slice(back + 1).filter((k) => k.startsWith("2:255:")).length).toBeGreaterThan(20);
  });

  it("repeat (waqf and ibtida'): the cursor goes back over the repeated words, then carries on", () => {
    // Nas's case: recite 33:49 up to عِدَّةٍ (word 17), repeat فَمَا لَكُمْ عَلَيْهِنَّ مِنْ عِدَّةٍ (13-17), then continue
    const { words, ref, table } = quran();
    const key = wordIndex(words).key;
    const idx = new Map(key.map((k, i) => [k, i]));
    const unitOf = new Map(table.symbols.map((sym, i) => [sym, i]));
    const toUnits = (ph: string) => {
      const out: number[] = [];
      for (let i = 0; i < ph.length; ) {
        let n = Math.min(4, ph.length - i);
        while (n > 0 && !unitOf.has(ph.slice(i, i + n))) n--;
        if (n === 0) i++;
        else {
          out.push(unitOf.get(ph.slice(i, i + n))!);
          i += n;
        }
      }
      return out;
    };
    const range = (a: string, b: string) => Array.from({ length: idx.get(b)! - idx.get(a)! + 1 }, (_, i) => idx.get(a)! + i);
    const said = [...range("33:49:1", "33:49:17"), ...range("33:49:13", "33:49:17"), ...range("33:49:18", "33:49:22"), ...range("33:50:1", "33:50:6")];
    const units = said.flatMap((w) => toUnits(words.ph[w])); // the reference phonemes, about 7 units per 0.48 s step
    const s = new FollowSession(ref, words, table.symbols);
    const heard: string[] = [];
    let lost = 0;
    for (let step = 0; step * 7 < units.length; step++)
      for (const e of s.push(units.slice(step * 7, step * 7 + 7), step, step * 0.48)) {
        if (e.type === "heard") heard.push(...e.words.map((w) => key[w.idx] + (w.status === "repeat" ? "(r)" : "")));
        if (e.type === "lost") lost++;
      }
    expect(lost).toBe(0);
    const repeats = heard.filter((h) => h.endsWith("(r)"));
    expect(repeats).toEqual(["33:49:13(r)", "33:49:14(r)", "33:49:15(r)", "33:49:16(r)", "33:49:17(r)"]);
    expect(heard.slice(heard.indexOf("33:49:17(r)") + 1, heard.indexOf("33:49:17(r)") + 6)).toEqual(["33:49:18", "33:49:19", "33:49:20", "33:49:21", "33:49:22"]);
    expect(heard).toContain("33:50:6");
  });

});

describe("verify mode (follow live, check after stop)", () => {
  /** What the engine worker does: follow each step, then verify the passage it followed. */
  function verifyRun(name: string) {
    const { fx, lp } = loadFixture(FIXTURES, name);
    const { words, ref, table } = quran();
    const s = new FollowSession(ref, words, table.symbols);
    const steps = Math.ceil(fx.frames / fx.stepFrames);
    for (let step = 0; step < steps; step++) {
      const units = fx.units.filter(([, f]) => Math.floor(f / fx.stepFrames) === step).map(([u]) => u);
      s.push(units, step, ((step + 1) * fx.stepFrames * fx.frameMs) / 1000);
    }
    const range = s.passage()!;
    const heard = fx.units.map(([unit, frame]) => ({ unit, time: frame * 0.04 }));
    const { findings } = verify(heard, lp, words, table, ref, range.from, range.to);
    const key = wordIndex(words).key;
    return { range, findings: findings.map((f) => ({ kind: f.kind, first: key[f.words[0]] })) };
  }

  it("clean: the passage is found from the recitation, and nothing is flagged", () => {
    const { range, findings } = verifyRun("husary-2-255-clean");
    expect(range).toEqual({ from: "2:255", to: "2:255" });
    expect(findings).toEqual([]);
  });

  it("skip: the cut words are reported, nothing else", () => {
    const { range, findings } = verifyRun("husary-2-255-skip");
    expect(range).toEqual({ from: "2:255", to: "2:255" });
    expect(findings).toEqual([{ kind: "SKIPPED", first: "2:255:18" }]);
  });

  it("slip: the brief visit to 3:3 is not taken as the passage, and is reported as a slip", () => {
    const { range, findings } = verifyRun("husary-2-255-slip");
    expect(range).toEqual({ from: "2:255", to: "2:255" });
    expect(findings.map((f) => f.kind)).toEqual(["MUTASHABIH_SLIP"]);
    expect(findings[0].first.startsWith("3:3:")).toBe(true);
  });
});
