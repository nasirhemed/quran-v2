import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pageLayout, type LayoutLine } from "@/lib/mushaf/layout";
import { applyLayout, pageIndex, type LayoutFile } from "@/lib/mushaf/layouts";
import type { QuranPage } from "@/types";

const read = (f: string) => JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/data", f), "utf-8"));
const base: QuranPage[] = read("quran-pages.json");
const file: LayoutFile = read("mushaf-1405.json");
const pages = applyLayout(base, file);
const text = (line: LayoutLine) => (line.kind === "text" ? line.items : []);
const firstAyah = (p: QuranPage) => `${p.surahGroups[0].ayahs[0].surah}:${p.surahGroups[0].ayahs[0].ayah}`;

describe("mushaf layout (QCF V1, the 1405H print)", () => {
  it("is the qcf-v1 pack's layout, with 604 pages", () => {
    expect(file.id).toBe("1405");
    expect(file.pack).toEqual({ id: "qcf-v1", version: "1" });
    expect(pages).toHaveLength(604);
  });

  it("has 15 printed lines per page, 8 on the two opening pages, each with something on it", () => {
    for (const p of pages) {
      const lines = pageLayout(p);
      expect(lines, `page ${p.pageNumber}`).toHaveLength(p.pageNumber <= 2 ? 8 : 15);
      for (const l of lines) if (l.kind === "text") expect(l.items.length, `page ${p.pageNumber} line ${l.n}`).toBeGreaterThan(0);
    }
  });

  it("keeps the base words (text, Hafs text) and only changes their glyphs and lines", () => {
    const words = (ps: QuranPage[]) => ps.flatMap((p) => p.surahGroups.flatMap((g) => g.ayahs.flatMap((a) => a.words)));
    const ours = words(pages);
    const theirs = words(base);
    expect(ours).toHaveLength(theirs.length);
    ours.forEach((w, i) => {
      expect(w.text).toBe(theirs[i].text);
      expect(w.hafs).toBe(theirs[i].hafs);
    });
    expect(ours.filter((w, i) => w.glyph !== theirs[i].glyph).length).toBeGreaterThan(ours.length * 0.9);
  });

  it("places every word once, in reading order, each ayah closed by its ornament", () => {
    for (const p of pages) {
      const drawn = pageLayout(p).flatMap(text);
      const expected = p.surahGroups.flatMap((g) =>
        g.ayahs.flatMap((a) => [...a.words.map((w) => `${a.surah}:${a.ayah}:${w.position}`), `${a.surah}:${a.ayah}:end`]),
      );
      expect(drawn.map((it) => (it.kind === "word" ? `${it.ayahKey}:${it.word.position}` : `${it.ayahKey}:end`))).toEqual(expected);
    }
  });

  it("gives every surah one header, followed by a bismillah except al-Fatiha and at-Tawba", () => {
    const flat = pages.flatMap((p) => pageLayout(p));
    const headers: number[] = [];
    flat.forEach((l, i) => {
      if (l.kind !== "surah") return;
      headers.push(l.surah);
      expect(flat[i + 1].kind, `surah ${l.surah}`).toBe(l.surah === 1 || l.surah === 9 ? "text" : "bismillah");
    });
    expect(headers).toEqual(Array.from({ length: 114 }, (_, i) => i + 1));
  });

  it("breaks pages as the 1405H print does where it differs from 1421H", () => {
    // 1421H: page 121 opens at 5:78, page 600 at 100:6
    expect(firstAyah(pages[120])).toBe("5:77");
    expect(firstAyah(pages[599])).toBe("100:10");
    expect(firstAyah(pages[584])).toBe("80:1"); // where both prints agree
    const { ayahPage, surahPage } = pageIndex(pages);
    expect(ayahPage.get("5:77")).toBe(121);
    expect(surahPage.get(2)).toBe(2);
    expect(surahPage.get(114)).toBe(604);
    const differ = new Set<number>();
    const basePage = pageIndex(base).ayahPage;
    for (const [k, p] of ayahPage) if (basePage.get(k) !== p) differ.add(p);
    expect(differ.size).toBeGreaterThan(20);
    expect(differ.size).toBeLessThan(40);
  });

  it("gives each page its own line width (the V1 fonts are not drawn to one scale), none wider than the print's", () => {
    for (const p of pages.slice(2)) {
      expect(p.lineWidthEm, `page ${p.pageNumber}`).toBeGreaterThan(13);
      expect(p.lineWidthEm!).toBeLessThanOrEqual(file.lineWidthEm);
    }
    expect(pages[0].lineWidthEm).toBeUndefined();
  });

  it("centres the short lines only", () => {
    const centered = pages.flatMap((p) => pageLayout(p).filter((l) => l.kind === "text" && l.centered).map((l) => `${p.pageNumber}:${l.n}`));
    expect(centered.filter((k) => Number(k.split(":")[0]) > 2).length).toBeLessThan(30);
    expect(centered).toContain("604:15");
  });

  it("refuses a layout that disagrees with the text", () => {
    const broken: LayoutFile = { ...file, pages: file.pages.map((p, i) => (i === 10 ? { ...p, ayahs: p.ayahs.slice(1) } : p)) };
    expect(() => applyLayout(base, broken)).toThrow(/exactly once/);
  });
});
