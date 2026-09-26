/**
 * Follow and verify mode on replay fixtures: model B's real output for public recordings (tests/fixtures),
 * compared with what the Python prototype found. The owner's own recordings run too when present locally
 * ($RECITATION_PRIVATE_FIXTURES), never committed.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { passageWords, wordIndex } from "@/recitation/engine/data";
import { verify } from "@/recitation/engine/verify";
import { FIXTURES, PRIVATE_FIXTURES, heardUnits, loadFixture, quran, replayFollow, type Fixture } from "./helpers";

const keyOf = () => wordIndex(quran().words).key;

function checkFollow(fx: Fixture, minTracked: number) {
  const { words } = quran();
  const { events, passed } = replayFollow(fx);
  const passage = passageWords(words, ...fx.passage);
  const tracked = passage.filter((w) => passed.has(w)).length / passage.length;
  expect(tracked).toBeGreaterThanOrEqual(minTracked);
  // parity with the prototype: the same first lock (±2 words), and the same number of lost/located events (±2)
  const key = keyOf();
  const idx = new Map(key.map((k, i) => [k, i]));
  const first = events.find((e) => e.type === "located")!;
  const pyFirst = fx.expected.follow.find((e) => e.type === "located")!;
  expect(Math.abs(first.word - idx.get(pyFirst.word)!)).toBeLessThanOrEqual(2);
  const count = (t: string, list: { type: string }[]) => list.filter((e) => e.type === t).length;
  expect(Math.abs(count("lost", events) - count("lost", fx.expected.follow))).toBeLessThanOrEqual(2);
  return { tracked, events };
}

function checkVerify(fx: Fixture, lp: ReturnType<typeof loadFixture>["lp"]) {
  const { words, table, ref } = quran();
  const { findings } = verify(heardUnits(fx), lp, words, table, ref, ...fx.passage);
  const key = keyOf();
  const got = findings.map((f) => ({ kind: f.kind, first: key[f.words[0]], time: f.time }));
  const want = fx.expected.verify.map((f) => ({ kind: f.kind, first: f.words[0], time: f.time }));
  return { got, want };
}

/** Findings of the same kind within 5 s of each other count as the same mistake. */
type Found = { kind: string; first: string; time: number };
function compare(got: Found[], want: Found[]) {
  const same = (a: Found, b: Found) => a.kind === b.kind && Math.abs(a.time - b.time) <= 5;
  return {
    found: want.filter((w) => got.some((g) => same(g, w))).length,
    extra: got.filter((g) => !want.some((w) => same(g, w))),
    missed: want.filter((w) => !got.some((g) => same(g, w))),
  };
}
const strip = (list: { kind: string; first: string }[]) => list.map(({ kind, first }) => ({ kind, first }));

describe("follow mode", () => {
  it("tracks a correct recitation from its opening", () => {
    const { fx } = loadFixture(FIXTURES, "husary-2-255-clean");
    const { events } = checkFollow(fx, 0.95);
    // 2:255 opens with the same 7 words as 3:2: the tracker must not commit to 3:2
    const first = events.find((e) => e.type === "located")!;
    expect(keyOf()[first.word].startsWith("2:255:")).toBe(true);
  });
  it("moves on after a skip", () => {
    const { fx } = loadFixture(FIXTURES, "husary-2-255-skip");
    checkFollow(fx, 0.9);
  });
  it("follows a slip into a similar verse and comes back", () => {
    const { fx } = loadFixture(FIXTURES, "husary-2-255-slip");
    const { events } = checkFollow(fx, 0.9);
    const key = keyOf();
    expect(events.some((e) => key[e.word].startsWith("3:3:"))).toBe(true);
    // …and ends back in 2:255 (or just past its last word)
    const last = events[events.length - 1];
    expect(["2:255:", "2:256:1"].some((p) => key[last.word].startsWith(p))).toBe(true);
  });
});

describe("verify mode", () => {
  it("reports nothing for a correct recitation", () => {
    const { fx, lp } = loadFixture(FIXTURES, "husary-2-255-clean");
    expect(checkVerify(fx, lp).got).toEqual([]);
  });
  it("reports the skipped words", () => {
    const { fx, lp } = loadFixture(FIXTURES, "husary-2-255-skip");
    const { got, want } = checkVerify(fx, lp);
    expect(strip(got)).toEqual(strip(want));
    expect(strip(got)).toEqual([{ kind: "SKIPPED", first: "2:255:18" }]);
  });
  it("reports the slip into 3:3, and nothing else", () => {
    const { fx, lp } = loadFixture(FIXTURES, "husary-2-255-slip");
    const { got, want } = checkVerify(fx, lp);
    expect(strip(got)).toEqual(strip(want));
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe("MUTASHABIH_SLIP");
    expect(got[0].first.startsWith("3:3:")).toBe(true);
  });
});

// The owner's recordings (kept out of git). Each is a folder with <name>.json + <name>.lp.bin.
const privateDirs = fs.existsSync(PRIVATE_FIXTURES)
  ? fs.readdirSync(PRIVATE_FIXTURES)
      .map((d) => path.join(PRIVATE_FIXTURES, d, "fixture"))
      .filter((d) => fs.existsSync(d))
  : [];
describe.skipIf(privateDirs.length === 0)("private recordings (skipped when absent)", () => {
  for (const dir of privateDirs) {
    const name = fs.readdirSync(dir).find((f) => f.endsWith(".json"))!.replace(/\.json$/, "");
    // Long, messy recordings can align differently from the prototype where two alignments tie (restarts,
    // off-text stretches), so verify must agree on at least 80% of the prototype's findings, with at most 3 others.
    it(`${name}: follow tracks ≥ 95%, verify agrees with the prototype`, () => {
      const { fx, lp } = loadFixture(dir, name);
      const { tracked } = checkFollow(fx, 0.95);
      const { got, want } = checkVerify(fx, lp);
      const { found, extra, missed } = compare(got, want);
      console.log(`${name}: tracked ${(100 * tracked).toFixed(1)}%; verify found ${found}/${want.length} of the prototype's findings`,
        { extra: strip(extra), missed: strip(missed) });
      expect(found / Math.max(1, want.length)).toBeGreaterThanOrEqual(0.8);
      expect(extra.length).toBeLessThanOrEqual(3);
    });
  }
});
