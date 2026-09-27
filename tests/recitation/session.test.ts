/**
 * FollowSession: the follow-mode events the screen uses (heard words, cursor, ayah breaks, voice search),
 * replayed from the public fixtures (model B's real output for Husary 2:255, clean / skip / slip).
 */
import { describe, expect, it } from "vitest";
import { passageWords, wordIndex } from "@/recitation/engine/data";
import { FollowSession, type EngineEvent } from "@/recitation/engine/session";
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
});
