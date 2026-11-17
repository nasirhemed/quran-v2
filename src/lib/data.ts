import type {
  QuranPage,
  SurahMeta,
  JuzMeta,
  AyahHighlights,
  MutashabihatPhrase,
  SimilarAyahEntry,
} from "@/types";
import { applyLayout, basePages, MUSHAF_LAYOUTS, type LayoutFile, type MushafLayoutId, type MushafPages } from "@/lib/mushaf/layouts";

const cache: Record<string, unknown> = {};

async function fetchJson<T>(url: string): Promise<T> {
  if (cache[url]) return cache[url] as T;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const data = await res.json();
  cache[url] = data;
  return data as T;
}

export async function fetchQuranPages(): Promise<QuranPage[]> {
  return fetchJson("/data/quran-pages.json");
}

const layouts: Partial<Record<MushafLayoutId, Promise<MushafPages>>> = {};

/** A print's pages (quran-pages.json's words on that print's pages and lines), built once per session. */
export function fetchMushafPages(id: MushafLayoutId): Promise<MushafPages> {
  const def = MUSHAF_LAYOUTS[id];
  if (!def.layoutUrl) return fetchQuranPages().then(basePages);
  const url = def.layoutUrl;
  const p = (layouts[id] ??= Promise.all([fetchQuranPages(), fetchJson<LayoutFile>(url)]).then(([base, file]) => ({
    layout: def,
    pages: applyLayout(base, file),
    lineWidthEm: file.lineWidthEm,
  })));
  p.catch(() => delete layouts[id]); // a failed download can be tried again
  return p;
}

export async function fetchSurahs(): Promise<SurahMeta[]> {
  return fetchJson("/data/surahs.json");
}

export async function fetchJuzMetadata(): Promise<JuzMeta[]> {
  return fetchJson("/data/juz-metadata.json");
}

export async function fetchAyahHighlights(): Promise<AyahHighlights> {
  return fetchJson("/data/ayah-highlights.json");
}

export async function fetchMutashabihatDetails(): Promise<
  Record<string, MutashabihatPhrase>
> {
  return fetchJson("/data/mutashabihat-details.json");
}

export async function fetchSimilarAyahDetails(): Promise<
  Record<string, SimilarAyahEntry>
> {
  return fetchJson("/data/similar-ayah-details.json");
}
