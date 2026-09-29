import type { QuranPage, QuranWord } from "@/types";

/** A word, or an ayah-number ornament, where the print places it. */
export type LineItem =
  | { kind: "word"; word: QuranWord; surah: number; ayah: number; ayahKey: string; wordIndex0: number }
  | { kind: "end"; glyph: string; surah: number; ayah: number; ayahKey: string };

export type LayoutLine =
  | { n: number; kind: "surah"; surah: number }
  | { n: number; kind: "bismillah" }
  | { n: number; kind: "text"; centered: boolean; items: LineItem[] };

/** The page as printed: its lines top to bottom, each with the words and ornaments on it in reading order. */
export function pageLayout(page: QuranPage): LayoutLine[] {
  const items = new Map<number, LineItem[]>();
  const on = (line: number) => {
    let list = items.get(line);
    if (!list) items.set(line, (list = []));
    return list;
  };
  for (const group of page.surahGroups) {
    for (const a of group.ayahs) {
      const ayahKey = `${a.surah}:${a.ayah}`;
      for (const word of a.words) {
        on(word.lineNumber).push({ kind: "word", word, surah: a.surah, ayah: a.ayah, ayahKey, wordIndex0: word.position - 1 });
      }
      on(a.end.lineNumber).push({ kind: "end", glyph: a.end.glyph, surah: a.surah, ayah: a.ayah, ayahKey });
    }
  }
  return page.lines.map((line, i) => {
    const n = i + 1;
    if (line.kind === "text") return { n, kind: "text", centered: !!line.centered, items: items.get(n) ?? [] };
    return { n, ...line };
  });
}

/** The words of 1:1 (the bismillah) as glyphs of page 1's font, for bismillah lines. */
export function bismillahGlyphs(pages: QuranPage[]): string[] {
  return pages[0].surahGroups[0].ayahs[0].words.map((w) => w.glyph);
}

/** An ayah number as copied text: "(٨)", in Arabic-Indic digits. */
export function ayahNumberText(ayah: number): string {
  return `(${String(ayah).replace(/\d/g, (d) => String.fromCharCode(0x660 + Number(d)))})`;
}
