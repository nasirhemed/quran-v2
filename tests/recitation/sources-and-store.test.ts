import { describe, expect, it } from "vitest";
import { Follower } from "@/recitation/engine/follow";
import { verify } from "@/recitation/engine/verify";
import { passageWords, wordIndex } from "@/recitation/engine/data";
import type { ChunkEvent } from "@/recitation/sources/RecognizerSource";
import { ReplaySource } from "@/recitation/sources/ReplaySource";
import { TranscriptStore } from "@/recitation/transcript/TranscriptStore";
import { FIXTURES, loadFixture, quran } from "./helpers";

describe("ReplaySource", () => {
  it("emits one chunk per model step, in order, and drives the engine end to end", async () => {
    const { fx, lp } = loadFixture(FIXTURES, "husary-2-255-skip");
    const { words, table, ref } = quran();
    const src = new ReplaySource({ ...fx, logprobs: lp }, Infinity);
    const chunks: ChunkEvent[] = [];
    const follower = new Follower(ref);
    src.on("chunk", (c) => {
      chunks.push(c);
      follower.push(c.units.map((u) => table.symbols[u.id]).join(""), c.emittedAtMs / 1000);
    });
    await src.start();
    await src.finished();
    expect(chunks.map((c) => c.chunk)).toEqual(chunks.map((_, i) => i)); // no dropped steps
    expect(chunks).toHaveLength(Math.ceil(fx.frames / fx.stepFrames));
    expect(chunks.flatMap((c) => c.units)).toHaveLength(fx.units.length);
    const key = wordIndex(words).key;
    expect(key[follower.cursor!]).toMatch(/^2:25[56]:/);

    // verify mode after stop, on the source's log-probs
    const heard = chunks.flatMap((c) => c.units.map((u) => ({ unit: u.id, time: (u.frame * fx.frameMs) / 1000 })));
    const { findings } = verify(heard, await src.logProbs(), words, table, ref, "2:255", "2:255");
    expect(findings.map((f) => [f.kind, key[f.words[0]]])).toEqual([["SKIPPED", "2:255:18"]]);
    expect(passageWords(words, "2:255", "2:255")).toHaveLength(50);
  });

  it("paces steps in real time when asked", async () => {
    const { fx, lp } = loadFixture(FIXTURES, "husary-2-255-clean");
    const short = { ...fx, frames: 36, units: fx.units.filter(([, f]) => f < 36), logprobs: lp };
    const src = new ReplaySource(short, 10); // 10× real time: 3 steps of 480 ms ≈ 144 ms
    const t0 = Date.now();
    let n = 0;
    src.on("chunk", () => n++);
    await src.start();
    await src.finished();
    expect(n).toBe(3);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90);
  });
});

describe("TranscriptStore", () => {
  const word = (id: number, text: string) => ({ id, text, source: "aligned" as const, startFrame: id, endFrame: id + 1 });

  it("replaces the partial word and never changes final words", () => {
    const s = new TranscriptStore("t", 0);
    s.appendFinal([word(1, "بِسْمِ")]);
    s.setPartial(word(2, "ٱللَّ"));
    s.setPartial(word(2, "ٱللَّهِ"));
    expect(s.snapshot.words.map((w) => [w.text, w.final])).toEqual([["بِسْمِ", true], ["ٱللَّهِ", false]]);
    s.appendFinal([word(2, "ٱللَّهِ"), word(3, "ٱلرَّحْمَـٰنِ")]);
    expect(s.snapshot.words.map((w) => [w.text, w.final])).toEqual([["بِسْمِ", true], ["ٱللَّهِ", true], ["ٱلرَّحْمَـٰنِ", true]]);
  });

  it("flushes the partial word on stop", () => {
    const s = new TranscriptStore();
    s.appendFinal([word(1, "a")]);
    s.setPartial(word(2, "b"));
    s.flush();
    expect(s.snapshot.words.every((w) => w.final)).toBe(true);
    expect(s.text()).toBe("a b");
  });

  it("applies annotations; cleared removes a mistake", () => {
    const s = new TranscriptStore();
    s.appendFinal([word(1, "a"), word(2, "b")]);
    s.annotate(2, { alignedTo: 42, status: "match" });
    s.markMistake(2, "WRONG_WORD");
    expect(s.snapshot.words[1]).toMatchObject({ alignedTo: 42, status: "match", mistake: "WRONG_WORD" });
    s.clearMistake(2);
    expect(s.snapshot.words[1].mistake).toBeUndefined();
    s.ayahComplete(2, 1, 1);
    expect(s.snapshot.ayahBreaks).toEqual([{ afterWordId: 2, surah: 1, ayah: 1 }]);
  });

  it("notifies once per batch", () => {
    const s = new TranscriptStore();
    let n = 0;
    s.subscribe(() => n++);
    s.batch(() => {
      s.appendFinal([word(1, "a")]);
      s.setPartial(word(2, "b"));
      s.annotate(1, { status: "match" });
    });
    expect(n).toBe(1);
  });
});
