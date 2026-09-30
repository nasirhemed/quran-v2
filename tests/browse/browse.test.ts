import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildBrowseIndex, foldArabic, matchRanges, searchBrowse } from "@/lib/browse";

const read = (name: string) =>
  JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/data", name), "utf-8"));
const surahs = read("surahs.json");
const index = buildBrowseIndex(
  read("quran-pages.json"),
  read("mutashabihat-details.json"),
  read("similar-ayah-details.json"),
  read("ayah-highlights.json")
);

describe("foldArabic", () => {
  it("matches text typed without harakat against Uthmani text", () => {
    expect(foldArabic("وَمَآ أَرۡسَلۡنَا")).toBe(foldArabic("وما ارسلنا"));
    expect(foldArabic("ٱلۡكِتَٰبِ")).toBe(foldArabic("الكتاب"));
    expect(foldArabic("ٱلرَّحۡمَٰنِ")).toBe(foldArabic("الرحمن"));
    expect(foldArabic("يَتَوَفَّىٰكُمْ ۖ")).toBe(foldArabic("يتوفاكم"));
    expect(foldArabic("مُوسَىٰٓ")).toBe(foldArabic("موسى"));
    expect(foldArabic("فِى")).toBe(foldArabic("في"));
  });
});

describe("buildBrowseIndex", () => {
  it("covers the Qur'an and keeps word ranges inside their verse", () => {
    expect(index.verses.size).toBe(6236);
    expect(index.matched.length).toBeGreaterThan(2500);
    for (const v of index.matched) {
      for (const p of v.phrases) for (const [from, to] of p.ranges) {
        expect(from).toBeGreaterThanOrEqual(1);
        expect(to).toBeLessThanOrEqual(v.words.length);
      }
      for (const s of v.similar) for (const [, to] of s.ranges) {
        expect(to).toBeLessThanOrEqual(index.verses.get(s.key)!.words.length);
      }
    }
  });

  it("lists similar verses from both sides of a pair", () => {
    expect(index.verses.get("1:1")!.similar.some((s) => s.key === "27:30")).toBe(true);
    expect(index.verses.get("27:30")!.similar.some((s) => s.key === "1:1")).toBe(true);
  });

  it("merges duplicate phrases and keeps their ids resolvable", () => {
    const signatures = index.phraseList.map((p) => p.occurrences.map((o) => o.key).join("|"));
    expect(new Set(signatures).size).toBe(signatures.length);
    for (const id of Object.keys(read("mutashabihat-details.json"))) expect(index.phrases.has(id)).toBe(true);
  });
});

describe("searchBrowse", () => {
  it("finds verses and phrases without harakat", () => {
    const r = searchBrowse(index, surahs, "وما ارسلنا");
    expect(r.verses.length).toBe(16);
    expect(r.verses.map((v) => v.key)).toContain("21:25");
    expect(r.phrases.length).toBeGreaterThan(0);
  });

  it("finds verses that have no similar phrase or verse too", () => {
    const r = searchBrowse(index, surahs, "قل يا ايها الكافرون");
    expect(r.verses.map((v) => v.key)).toEqual(["109:1"]);
    expect(r.verses[0].phrases.length + r.verses[0].similar.length).toBe(0);
  });

  it("finds verse keys and surah names", () => {
    expect(searchBrowse(index, surahs, "2:51").verse?.key).toBe("2:51");
    expect(searchBrowse(index, surahs, "baqara").surahs.map((s) => s.index)).toEqual([2]);
    expect(searchBrowse(index, surahs, "البقرة").surahs.map((s) => s.index)).toEqual([2]);
  });
});

describe("matchRanges", () => {
  it("maps a folded search back onto the words it covers", () => {
    const words = index.verses.get("21:25")!.words;
    expect(matchRanges(words, foldArabic("وما ارسلنا"))).toEqual([[1, 2]]);
    expect(matchRanges(words, foldArabic("رسلنا من"))).toEqual([[2, 3]]);
  });
});
