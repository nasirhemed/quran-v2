/**
 * The mushaf prints the reader can draw, chosen in Settings (hooks/useMushafLayout).
 *
 * - "1421": the 1421H Madinah print (QCF V2, as on quran.com). Its pages are public/data/quran-pages.json itself.
 * - "1405": the 1405H Madinah print (QCF V1), the King Fahd Complex's first 15-line Madinah mushaf. Same 604 pages
 *   and 15 lines, but its own calligraphy, its own line breaks and, on some pages, its own page breaks. Only its
 *   layout is stored (public/data/mushaf-1405.json: per page, each ayah's glyphs and lines); `applyLayout` lays it
 *   over quran-pages.json's words, so every word keeps the same text, Hafs text and position in both prints.
 *
 * Everything that works on words (search, Browse, voice) is the same in both. What changes with the print: the
 * reader's pages and its surah/juz start pages, Follow mode's page turns, and Practice's "to the end of the next
 * page".
 */
import type { PageLine, PageSurahGroup, QuranPage } from "@/types";
import { LINE_WIDTH_EM, QCF_V1, QCF_V2, type MushafPack } from "./pack";

export type MushafLayoutId = "1421" | "1405";

export interface MushafLayoutDef {
  id: MushafLayoutId;
  /** shown in Settings */
  name: string;
  description: string;
  pack: MushafPack;
  /** the pack's manifest, shipped with the app (precached) */
  manifestUrl: string;
  /** the layout file laid over quran-pages.json; null when quran-pages.json is this print */
  layoutUrl: string | null;
}

export const MUSHAF_LAYOUTS: Record<MushafLayoutId, MushafLayoutDef> = {
  "1421": {
    id: "1421",
    name: "Madinah Mushaf, 1421H",
    description: "The King Fahd Complex's current 15-line print, as on quran.com.",
    pack: QCF_V2,
    manifestUrl: "/data/mushaf-fonts.json",
    layoutUrl: null,
  },
  "1405": {
    id: "1405",
    name: "Madinah Mushaf, 1405H",
    description: "The King Fahd Complex's first 15-line Madinah print, in its original calligraphy.",
    pack: QCF_V1,
    manifestUrl: "/data/mushaf-fonts-1405.json",
    layoutUrl: "/data/mushaf-1405.json",
  },
};

export const DEFAULT_LAYOUT: MushafLayoutId = "1421";

export const isLayoutId = (v: unknown): v is MushafLayoutId => v === "1421" || v === "1405";

/** One ayah as a layout file stores it: [surah, ayah, word glyphs, word lines, ornament glyph, ornament line]. */
export type LayoutAyah = [number, number, string[], number[], string, number];

export interface LayoutPage {
  /** page number */
  p: number;
  juz: number;
  lines: PageLine[];
  ayahs: LayoutAyah[];
}

/** A print's layout file (scripts/build-mushaf-data.py --print 1405). */
export interface LayoutFile {
  id: MushafLayoutId;
  pack: MushafPack;
  /** the widest printed line in em of the pack's page fonts, plus a hair (as LINE_WIDTH_EM for 1421H) */
  lineWidthEm: number;
  pages: LayoutPage[];
}

/** A print ready to draw: its pages, with the same words as quran-pages.json. */
export interface MushafPages {
  layout: MushafLayoutDef;
  pages: QuranPage[];
  lineWidthEm: number;
}

/**
 * Lays a print's layout over the base pages' words. Throws if the two disagree on any ayah or word count, or if
 * the layout doesn't hold every ayah exactly once, in order.
 */
export function applyLayout(base: QuranPage[], file: LayoutFile): QuranPage[] {
  const words = new Map<string, QuranPage["surahGroups"][number]["ayahs"][number]["words"]>();
  const groupOf = new Map<number, Omit<PageSurahGroup, "ayahs">>();
  const order: string[] = [];
  for (const p of base) {
    for (const g of p.surahGroups) {
      if (g.isSurahStart || !groupOf.has(g.surahIndex)) {
        const { ayahs: _, ...meta } = g;
        groupOf.set(g.surahIndex, meta);
      }
      for (const a of g.ayahs) {
        words.set(`${a.surah}:${a.ayah}`, a.words);
        order.push(`${a.surah}:${a.ayah}`);
      }
    }
  }

  const seen: string[] = [];
  const pages = file.pages.map((lp): QuranPage => {
    const surahGroups: PageSurahGroup[] = [];
    for (const [s, a, glyphs, lines, endGlyph, endLine] of lp.ayahs) {
      const key = `${s}:${a}`;
      const ours = words.get(key);
      if (!ours || ours.length !== glyphs.length || glyphs.length !== lines.length) {
        throw new Error(`mushaf ${file.id}: ${key} has ${glyphs.length} words, the text has ${ours?.length ?? 0}`);
      }
      seen.push(key);
      let group = surahGroups[surahGroups.length - 1];
      if (!group || group.surahIndex !== s) {
        const meta = groupOf.get(s)!;
        const start = a === 1;
        group = { ...meta, isSurahStart: start, bismillah: start ? meta.bismillah : null, ayahs: [] };
        surahGroups.push(group);
      }
      group.ayahs.push({
        surah: s,
        ayah: a,
        words: ours.map((w, i) => ({ ...w, glyph: glyphs[i], lineNumber: lines[i] })),
        end: { glyph: endGlyph, lineNumber: endLine },
      });
    }
    return { pageNumber: lp.p, juz: lp.juz, surahGroups, lines: lp.lines };
  });
  if (seen.length !== order.length || seen.some((k, i) => k !== order[i])) {
    throw new Error(`mushaf ${file.id}: the pages do not hold every ayah exactly once, in order`);
  }
  return pages;
}

/** The base pages as the 1421H print. */
export function basePages(pages: QuranPage[]): MushafPages {
  return { layout: MUSHAF_LAYOUTS["1421"], pages, lineWidthEm: LINE_WIDTH_EM };
}

/** Page lookups that depend on the print: where each ayah, surah and juz starts. */
export interface PageIndex {
  /** "s:a" → page */
  ayahPage: Map<string, number>;
  /** surah → its first ayah's page */
  surahPage: Map<number, number>;
}

export function pageIndex(pages: QuranPage[]): PageIndex {
  const ayahPage = new Map<string, number>();
  const surahPage = new Map<number, number>();
  for (const p of pages) {
    for (const g of p.surahGroups) {
      for (const a of g.ayahs) {
        ayahPage.set(`${a.surah}:${a.ayah}`, p.pageNumber);
        if (a.ayah === 1) surahPage.set(a.surah, p.pageNumber);
      }
    }
  }
  return { ayahPage, surahPage };
}
