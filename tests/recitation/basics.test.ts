import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { opcodes } from "@/recitation/engine/align";
import { ctcViterbi, gop } from "@/recitation/engine/ctc";
import { passageWords, wordIndex, wordUnits } from "@/recitation/engine/data";
import { partialRatioAlignment, ratio } from "@/recitation/engine/fuzzy";
import { skeleton } from "@/recitation/engine/skeleton";
import { quran } from "./helpers";

describe("skeleton", () => {
  it("ignores harakat, madd length and gemination", () => {
    expect(skeleton("ررَحمَاانِ")).toBe(skeleton("رَحمَااااانِ"));
    expect(skeleton("بِسمِ للَااهِ")).toBe("بسمله");
  });
  it("maps ghunna nun and iqlab meem", () => {
    expect(skeleton("مِںںں")).toBe("من");
    expect(skeleton("فَضلِ۾۾۾")).toBe("فضلم");
  });
  it("makes a waqf ending differ from the wasl form by at most its tanween nun", () => {
    const wasl = skeleton("مُرِۦۦبِن"); // مُرِيبٍ read on
    const waqf = skeleton("مُرِۦۦۦۦب"); // stopped
    expect(wasl.startsWith(waqf)).toBe(true);
    expect(wasl.length - waqf.length).toBe(1);
  });
});

describe("fuzzy matching (values from rapidfuzz)", () => {
  it("ratio", () => {
    expect(ratio("نزلعليكلكتبلحق", "ءللهلءلههولحيلقيمنزلعليكلكتب")).toBeCloseTo(52.381, 3);
  });
  it("partial ratio alignment, including the windows at the ends", () => {
    expect(partialRatioAlignment("نزلعليكلكتبلحق", "ءللهلءلههولحيلقيمنزلعليكلكتب")).toEqual({ score: 88, destStart: 17, destEnd: 28 });
    expect(partialRatioAlignment("كتب", "ءلكتبلريب")).toEqual({ score: 100, destStart: 2, destEnd: 5 });
    const al = partialRatioAlignment("abcdef", "xxabcxdefyy");
    expect(al.score).toBeCloseTo(83.3333, 3);
    expect([al.destStart, al.destEnd]).toEqual([2, 8]);
  });
});

describe("alignment", () => {
  const cost = (a: string, b: string) =>
    opcodes(a, b).reduce((d, op) => d + (op.tag === "equal" ? 0 : Math.max(op.i2 - op.i1, op.j2 - op.j1)), 0);
  const brute = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
    return d[a.length][b.length];
  };
  it("covers both strings in order with equal blocks equal (Hirschberg on random strings)", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let n = 0; n < 60; n++) {
      const a = Array.from({ length: Math.floor(rnd() * 120) }, () => "ابتثج"[Math.floor(rnd() * 5)]).join("");
      const b = Array.from({ length: Math.floor(rnd() * 120) }, () => "ابتثج"[Math.floor(rnd() * 5)]).join("");
      let i = 0;
      let j = 0;
      for (const op of opcodes(a, b)) {
        expect([op.i1, op.j1]).toEqual([i, j]);
        if (op.tag === "equal") expect(a.slice(op.i1, op.i2)).toBe(b.slice(op.j1, op.j2));
        i = op.i2;
        j = op.j2;
      }
      expect([i, j]).toEqual([a.length, b.length]);
      expect(cost(a, b)).toBe(brute(a, b));
    }
  });
  it("finds the minimal Levenshtein cost", () => {
    for (const [a, b] of [["كتاب", "كتب"], ["بسمالله", "بسماللهالرحمن"], ["", "ابت"], ["ابتثج", "جثتبا"]]) {
      expect(cost(a, b)).toBe(brute(a, b));
    }
  });
});

describe("CTC scoring", () => {
  // 3 units + blank (3); frames strongly say: 1, blank, 2
  const vocab = 4;
  const rows = [[0, -9, -9, -9], [-9, -9, -9, 0], [-9, -9, 0, -9]];
  const lp = { data: Float32Array.from(rows.flat()), vocab, blank: 3 };
  it("prefers the sequence that was said", () => {
    expect(ctcViterbi(lp, 0, 3, [0, 2])).toBeCloseTo(0);
    expect(ctcViterbi(lp, 0, 3, [0, 1, 2])).toBeLessThan(-8);
    expect(ctcViterbi(lp, 0, 3, [0])).toBeLessThan(-8);
  });
  it("gives a good GOP to said units and a bad one to others", () => {
    expect(gop(lp, 0, 3, [0, 2])).toBeCloseTo(0);
    expect(gop(lp, 0, 3, [1, 2])).toBeLessThan(-3);
  });
});

describe("recitation data", () => {
  const { words, table } = quran();
  it("has every mushaf word of quran-pages.json, in the same order and ayat", () => {
    const pages = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/data/quran-pages.json"), "utf8"));
    const counts = new Map<string, number>();
    for (const p of pages) for (const g of p.surahGroups) for (const a of g.ayahs) counts.set(`${a.surah}:${a.ayah}`, a.words.length);
    expect(words.ph.length).toBe(77429);
    expect(Object.keys(words.ayat).length).toBe(6236);
    for (const [key, [, n]] of Object.entries(words.ayat)) expect(n).toBe(counts.get(key));
    expect(words.ph.every((p) => p.length > 0)).toBe(true);
  });
  it("splits words joined in recitation (idgham) at the right place", () => {
    const [first] = words.ayat["2:2"];
    expect(words.ph.slice(first + 5, first + 7)).toEqual(["هُدَ", "للِلمُتتَقِۦۦۦۦن"]);
    expect(words.ph[words.ayat["1:1"][0]]).toBe("بِسمِ");
  });
  it("turns phonemes into the model's units", () => {
    const units = wordUnits(words, table, "1:1");
    expect(units.map((u) => u.map((id) => table.symbols[id]).join(""))).toEqual(words.ph.slice(0, 4));
  });
  it("indexes words and passages", () => {
    const { key } = wordIndex(words);
    expect(key[0]).toBe("1:1:1");
    expect(passageWords(words, "1:1", "1:7")).toHaveLength(29);
  });
});
