import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ayahNumberText, bismillahGlyphs, pageLayout, type LayoutLine, type LineItem } from "@/lib/mushaf/layout";
import type { QuranPage } from "@/types";

const pages: QuranPage[] = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/data/quran-pages.json"), "utf-8"));
const layout = (n: number) => pageLayout(pages[n - 1]);
const text = (line: LayoutLine) => (line.kind === "text" ? line.items : []);
const label = (it: LineItem) => (it.kind === "word" ? it.word.text : `(${it.ayah})`);

describe("mushaf layout (QCF V2, the 1421H print)", () => {
  it("has 15 printed lines per page, 8 on the two opening pages, each with something on it", () => {
    for (const p of pages) {
      const lines = pageLayout(p);
      expect(lines, `page ${p.pageNumber}`).toHaveLength(p.pageNumber <= 2 ? 8 : 15);
      for (const l of lines) if (l.kind === "text") expect(l.items.length, `page ${p.pageNumber} line ${l.n}`).toBeGreaterThan(0);
    }
  });

  it("places every word once, in reading order, each ayah closed by its ornament", () => {
    for (const p of pages) {
      const drawn = pageLayout(p).flatMap(text);
      const expected: string[] = [];
      for (const g of p.surahGroups) {
        for (const a of g.ayahs) {
          for (const w of a.words) expected.push(`${a.surah}:${a.ayah}:${w.position}`);
          expected.push(`${a.surah}:${a.ayah}:end`);
        }
      }
      expect(drawn.map((it) => (it.kind === "word" ? `${it.ayahKey}:${it.word.position}` : `${it.ayahKey}:end`))).toEqual(expected);
      for (const it of drawn) if (it.kind === "word") expect(it.word.glyph.length, it.ayahKey).toBeGreaterThan(0);
    }
  });

  it("gives every surah one header, followed by a bismillah except al-Fatiha and at-Tawba", () => {
    const headers: number[] = [];
    const flat = pages.flatMap((p) => pageLayout(p));
    flat.forEach((l, i) => {
      if (l.kind !== "surah") return;
      headers.push(l.surah);
      const next = flat[i + 1];
      if (l.surah === 1 || l.surah === 9) expect(next.kind, `surah ${l.surah}`).toBe("text");
      else expect(next.kind, `surah ${l.surah}`).toBe("bismillah");
    });
    expect(headers).toEqual(Array.from({ length: 114 }, (_, i) => i + 1));
  });

  it("matches quran.com on page 453 (Sad): header on 452, ornament 8 opening line 9", () => {
    const p452 = layout(452);
    expect(p452[14]).toEqual({ n: 15, kind: "surah", surah: 38 });
    const p453 = layout(453);
    expect(p453[0].kind).toBe("bismillah");
    const line9 = text(p453[8]);
    expect(label(line9[0])).toBe("(8)");
    expect(label(line9[line9.length - 1])).toBe("\u0645\u0651\u064f\u0644\u0652\u0643\u064f"); // مُّلْكُ, 38:10 word 3
  });

  it("centres the short lines only", () => {
    const centered = pages.flatMap((p) => pageLayout(p).filter((l) => l.kind === "text" && l.centered).map((l) => `${p.pageNumber}:${l.n}`));
    expect(centered.filter((k) => Number(k.split(":")[0]) > 2).length).toBeLessThan(30);
    expect(centered).toContain("604:15"); // an-Nas ends mid-line
  });

  it("draws the bismillah from 1:1's four words", () => {
    expect(bismillahGlyphs(pages)).toHaveLength(4);
  });

  it("copies ayah numbers in Arabic-Indic digits", () => {
    expect(ayahNumberText(3)).toBe("(٣)");
    expect(ayahNumberText(286)).toBe("(٢٨٦)");
  });
});
