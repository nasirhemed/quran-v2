/** Mushaf text and page of each word key ("s:a:w", w = 1-based position), from the reader's page data. */
import type { QuranPage } from "@/types";

export interface WordLookup {
  text(key: string): string;
  page(key: string): number | undefined;
}

const cache = new WeakMap<QuranPage[], WordLookup>();

export function wordLookup(pages: QuranPage[]): WordLookup {
  let l = cache.get(pages);
  if (l) return l;
  const text = new Map<string, string>();
  const pageOf = new Map<string, number>();
  for (const p of pages)
    for (const g of p.surahGroups)
      for (const a of g.ayahs) {
        pageOf.set(`${a.surah}:${a.ayah}`, p.pageNumber);
        for (const w of a.words) text.set(`${a.surah}:${a.ayah}:${w.position}`, w.text);
      }
  const ayahOf = (key: string) => key.split(":").slice(0, 2).join(":");
  l = { text: (k) => text.get(k) ?? "…", page: (k) => pageOf.get(ayahOf(k)) };
  cache.set(pages, l);
  return l;
}
