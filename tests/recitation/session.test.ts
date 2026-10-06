/**
 * FollowSession: the follow-mode events the screen uses (heard words, cursor, ayah breaks, voice search),
 * replayed from the public fixtures (model B's real output for Husary 2:255, clean / skip / slip).
 */
import { describe, expect, it } from "vitest";
import { passageWords, wordIndex } from "@/recitation/engine/data";
import { FollowSession, type EngineEvent } from "@/recitation/engine/session";
import { FIXTURES, loadFixture, quran, referenceUnits, type Fixture } from "./helpers";

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

describe("follow session told the verse (memorisation loop)", () => {
  function runExpecting(fx: Fixture, ayah: string) {
    const { words, ref, table } = quran();
    const s = new FollowSession(ref, words, table.symbols);
    s.expect(words.ayat[ayah][0]);
    const byStep = new Map<number, number[]>();
    for (const [u, frame] of fx.units) {
      const step = Math.floor(frame / fx.stepFrames);
      byStep.set(step, [...(byStep.get(step) ?? []), u]);
    }
    const events: EngineEvent[] = [];
    const steps = Math.ceil(fx.frames / fx.stepFrames);
    for (let step = 0; step < steps; step++) events.push(...s.push(byStep.get(step) ?? [], step, ((step + 1) * fx.stepFrames * fx.frameMs) / 1000));
    const key = wordIndex(words).key;
    return { events, key };
  }
  const completeAt = (events: EngineEvent[], ayah: string) =>
    events.find((e): e is Extract<EngineEvent, { type: "ayahComplete" }> => e.type === "ayahComplete" && e.ayah === ayah)?.step;

  it("clean 2:255: no voice search (the opening shared with 3:2 is not in doubt), and the verse completes", () => {
    const { fx } = loadFixture(FIXTURES, "husary-2-255-clean");
    const { events, key } = runExpecting(fx, "2:255");
    expect(events.some((e) => e.type === "candidates" && e.places.length > 0)).toBe(false);
    expect(events.some((e) => e.type === "located")).toBe(false);
    const heard = events.flatMap((e) => (e.type === "heard" ? e.words.map((w) => key[w.idx]) : []));
    expect(heard[0]).toBe("2:255:1");
    expect(heard.every((k) => k.startsWith("2:255:"))).toBe(true);
    // completes no later than when the tracker has to find the verse by itself
    const told = completeAt(events, "2:255");
    const searched = completeAt(run(fx).events, "2:255");
    expect(told).toBeDefined();
    expect(told!).toBeLessThanOrEqual(searched!);
  });

  it("skip inside 2:255: the verse still completes", () => {
    const { fx } = loadFixture(FIXTURES, "husary-2-255-skip");
    expect(completeAt(runExpecting(fx, "2:255").events, "2:255")).toBeDefined();
  });

  it("slip into 3:3 and back: 2:255 still completes, after the slip", () => {
    const { fx } = loadFixture(FIXTURES, "husary-2-255-slip");
    const { events, key } = runExpecting(fx, "2:255");
    const heard = events.flatMap((e) => (e.type === "heard" ? e.words.map((w) => key[w.idx]) : []));
    expect(heard.some((k) => k.startsWith("3:3:"))).toBe(true);
    expect(completeAt(events, "2:255")).toBeDefined();
  });

  /** The verse's reference phonemes, `per` units a step, then silence; the ayahs completed and the words heard. */
  function recite(said: string[], ayah: string, per: number, s = new FollowSession(quran().ref, quran().words, quran().table.symbols)) {
    const { words } = quran();
    const key = wordIndex(words).key;
    const idx = new Map(key.map((k, i) => [k, i]));
    const units = said.flatMap((k) => referenceUnits(words.ph[idx.get(k)!]));
    s.expect(words.ayat[ayah][0]);
    const completed: string[] = [];
    const heard: string[] = [];
    for (let step = 0; step < Math.ceil(units.length / per) + 3; step++)
      for (const e of s.push(units.slice(step * per, step * per + per), step, step * 0.48)) {
        if (e.type === "ayahComplete") completed.push(e.ayah);
        if (e.type === "heard") heard.push(...e.words.map((w) => key[w.idx]));
      }
    return { completed, heard, s };
  }
  const verse = (ayah: string) => {
    const [first, n] = quran().words.ayat[ayah];
    return Array.from({ length: n }, (_, i) => wordIndex(quran().words).key[first + i]);
  };

  it("a refrain whose words also end the verse before (55:18, 109:5) completes, with its own words", () => {
    for (const ayah of ["55:18", "55:77", "109:5", "77:19"])
      for (const per of [4, 8]) {
        const { completed, heard } = recite(verse(ayah), ayah, per);
        expect(completed, `${ayah}/${per}`).toEqual([ayah]);
        expect(heard.every((k) => k.startsWith(`${ayah}:`)), `${ayah}/${per}`).toBe(true);
      }
  });

  it("an ending with a letter shared across the last two words (غَفُورٌ رَّحِيمٌ, 2:192) completes", () => {
    for (const ayah of ["2:192", "2:167", "4:20", "13:11"]) for (const per of [2, 4, 8, 12]) expect(recite(verse(ayah), ayah, per).completed, `${ayah}/${per}`).toEqual([ayah]);
  });

  it("a verse too short to track (يس, طه, 112:2) completes once all of it is heard, and not before", () => {
    for (const ayah of ["36:1", "20:1", "112:2", "55:1"]) {
      const { completed, heard } = recite(verse(ayah), ayah, 4);
      expect(completed, ayah).toEqual([ayah]);
      expect(new Set(heard), ayah).toEqual(new Set(verse(ayah)));
    }
    expect(recite([], "36:1", 4).completed).toEqual([]);
  });

  it("a slip back into the verse before is reported (it completes too), and the expected verse doesn't", () => {
    const { completed } = recite(verse("2:255"), "2:256", 8);
    expect(completed).toContain("2:255");
    expect(completed).not.toContain("2:256");
  });

  it("a session told the same verse twice completes it both times", () => {
    const first = recite(verse("1:2"), "1:2", 4);
    expect(first.completed).toEqual(["1:2"]);
    expect(recite(verse("1:2"), "1:2", 4, first.s).completed).toEqual(["1:2"]);
  });

  it("a twin verse (the same words elsewhere) counts as the expected one: its words and its completion", () => {
    // expecting 55:18 but the tracker ends up on 55:21 (identical): the words heard are 55:18's, and 55:18 completes
    const { words, ref, table } = quran();
    const s = new FollowSession(ref, words, table.symbols);
    s.expect(words.ayat["55:21"][0]);
    s.expect(words.ayat["55:18"][0]); // re-expect on a reused session: the twin set is the new verse's
    const key = wordIndex(words).key;
    const units = verse("55:21").flatMap((k) => referenceUnits(words.ph[key.indexOf(k)]));
    // put the tracker on 55:21 directly, as if it had lost its place and found this copy
    s.follower.startAt(words.ayat["55:21"][0]);
    const completed: string[] = [];
    const heard: string[] = [];
    for (let step = 0; step < Math.ceil(units.length / 4) + 3; step++)
      for (const e of s.push(units.slice(step * 4, step * 4 + 4), step, step * 0.48)) {
        if (e.type === "ayahComplete") completed.push(e.ayah);
        if (e.type === "heard") heard.push(...e.words.map((w) => key[w.idx]));
      }
    expect(completed).toEqual(["55:18"]);
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.every((k) => k.startsWith("55:18:"))).toBe(true);
  });
});
