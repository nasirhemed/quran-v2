import type {
  QuranPage,
  SurahMeta,
  JuzMeta,
  AyahHighlights,
  MutashabihatPhrase,
  SimilarAyahEntry,
} from "@/types";

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
