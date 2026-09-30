import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAyahIndex,
  buildSimilarGroups,
  commonPrefix,
  differingRanges,
  sharedOpening,
  generateCompetitionQuestions,
  generateSimilarQuestions,
  HUGE_GROUP_LIMIT,
  type PracticeConfig,
} from "@/lib/practice";

const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/data", name), "utf-8"));
const index = buildAyahIndex(read("quran-pages.json"));
const groups = buildSimilarGroups(read("similar-ayah-details.json"), index);
const folded = (key: string) => index.get(key)!.folded;
const all: PracticeConfig = { range: { type: "juz", from: 1, to: 30 }, mode: "similar", count: 20 };

describe("word diff", () => {
  it("marks the words where look-alikes differ", () => {
    // وَسَلَـٰمٌ عَلَيْهِ يَوْمَ وُلِدَ وَيَوْمَ يَمُوتُ … / وَٱلسَّلَـٰمُ عَلَىَّ يَوْمَ وُلِدتُّ وَيَوْمَ أَمُوتُ …
    expect(differingRanges(folded("19:15"), folded("19:33"))).toEqual([
      [1, 2],
      [4, 4],
      [6, 6],
      [8, 8],
    ]);
    expect(differingRanges(folded("19:15"), folded("19:15"))).toEqual([]);
  });

  it("finds where two verses part", () => {
    // وَإِذْ قُلْنَا ٱدْخُلُوا۟ هَـٰذِهِ ٱلْقَرْيَةَ / وَإِذْ قِيلَ لَهُمُ ٱسْكُنُوا۟ هَـٰذِهِ ٱلْقَرْيَةَ
    expect(commonPrefix(folded("2:58"), folded("7:161"))).toBe(1);
    // ٱلَّذِينَ هُمْ عَلَىٰ صَلَاتِهِمْ دَآئِمُونَ / وَٱلَّذِينَ هُمْ عَلَىٰ صَلَاتِهِمْ يُحَافِظُونَ
    expect(sharedOpening(folded("70:23"), folded("70:34"))).toBe(4);
    expect(sharedOpening(folded("3:51"), folded("36:61"))).toBeLessThan(2);
  });
});

describe("buildSimilarGroups", () => {
  it("keeps real look-alikes and drops pairs that only share a formula", () => {
    expect(groups.length).toBeGreaterThan(500);
    const with19 = groups.find((g) => g.keys.includes("19:15") && g.keys.includes("19:33"));
    expect(with19).toBeDefined();
    // 1:1 and 41:2 only share ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ.
    expect(groups.some((g) => g.keys[0] === "1:1" && g.keys.includes("41:2"))).toBe(false);
    for (const g of groups) expect(new Set(g.keys).size).toBe(g.keys.length);
  });
});

describe("generateSimilarQuestions", () => {
  const qs = generateSimilarQuestions(groups, index, all);

  it("walks whole groups, each verse once", () => {
    expect(qs.length).toBeGreaterThanOrEqual(all.count);
    expect(new Set(qs.map((q) => q.key)).size).toBe(qs.length);
    for (const q of qs) {
      expect(q.groupSize!).toBeLessThanOrEqual(HUGE_GROUP_LIMIT);
      expect(q.lookAlikes.length).toBeGreaterThan(0);
      expect(q.hideLocation).toBe(false);
    }
  });

  it("prompts with a shared opening that stops where the verses part", () => {
    for (let i = 0; i < 20; i++) {
      for (const q of generateSimilarQuestions(groups, index, all)) {
        const k = q.words.findIndex((_, i) => q.words.slice(0, i + 1).join(" ") === q.hint) + 1;
        expect(k).toBeGreaterThan(0);
        expect(k).toBeLessThan(q.words.length);
        if (q.sameOpening === 0) continue;
        const shown = folded(q.key).slice(0, k);
        const twins = q.lookAlikes.filter((t) => sharedOpening(shown, folded(t.key)) === k);
        expect(twins.length).toBe(q.sameOpening);
      }
    }
  });

  it("stays in range", () => {
    const juz30: PracticeConfig = { ...all, range: { type: "juz", from: 30, to: 30 } };
    for (const q of generateSimilarQuestions(groups, index, juz30)) {
      expect(index.get(q.key)!.juz).toBe(30);
    }
  });
});

describe("generateCompetitionQuestions", () => {
  const config: PracticeConfig = { ...all, mode: "competition" };

  it("gives a prompt found in only one place, and hides where it is", () => {
    const haystack = ` ${[...index.values()].flatMap((a) => a.folded).join(" ")} `;
    let midVerse = 0;
    for (let i = 0; i < 10; i++) {
      const qs = generateCompetitionQuestions(groups, index, config);
      expect(qs).toHaveLength(config.count);
      for (const q of qs) {
        expect(q.hideLocation).toBe(true);
        const [[from, to]] = q.marks;
        expect(q.words.slice(from - 1, to).join(" ")).toBe(q.hint);
        expect(to).toBeLessThan(q.words.length);
        const needle = ` ${folded(q.key).slice(from - 1, to).join(" ")} `;
        const at = haystack.indexOf(needle);
        expect(at).toBeGreaterThanOrEqual(0);
        expect(haystack.indexOf(needle, at + 1) !== -1).toBe(q.ambiguous);
        if (q.midVerse) midVerse++;
      }
    }
    expect(midVerse).toBeGreaterThan(0);
  });

  it("lands half the prompts on verses that have a look-alike", () => {
    const grouped = new Set(groups.flatMap((g) => g.keys));
    const qs = generateCompetitionQuestions(groups, index, config);
    expect(qs.filter((q) => grouped.has(q.key)).length).toBeGreaterThanOrEqual(config.count / 2);
  });
});
