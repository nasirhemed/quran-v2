import type {
  AyahHighlights,
  MutashabihatPhrase,
  QuranPage,
  SimilarAyahEntry,
  SurahMeta,
} from "@/types";

/** 1-indexed [from, to] word range, as in the phrase and similarity data. */
export type WordRange = [number, number];

export interface VersePhrase {
  id: string;
  /** where the phrase sits in this verse */
  ranges: WordRange[];
}

export interface VerseSimilar {
  key: string;
  score: number;
  /** matched words */
  words: number;
  /** the matched words in the OTHER verse (`key`) */
  ranges: WordRange[];
}

export interface BrowseVerse {
  key: string;
  surah: number;
  ayah: number;
  juz: number;
  /** word texts, in the segmentation the word ranges use */
  words: string[];
  /** Mutashabihat phrases in this verse (duplicates merged) */
  phrases: VersePhrase[];
  /** similar verses, best match first */
  similar: VerseSimilar[];
}

export interface BrowsePhrase {
  id: string;
  text: string;
  surahCount: number;
  /** in mushaf order */
  occurrences: { key: string; ranges: WordRange[] }[];
}

export interface BrowseIndex {
  /** every verse of the Qur'an */
  verses: Map<string, BrowseVerse>;
  /** verses with at least one phrase or similar verse, in mushaf order */
  matched: BrowseVerse[];
  /** `matched`, per surah */
  bySurah: Map<number, BrowseVerse[]>;
  /** phrase id → phrase; ids of merged duplicates point at the phrase they were merged into */
  phrases: Map<string, BrowsePhrase>;
  /** one entry per distinct phrase, most occurrences first */
  phraseList: BrowsePhrase[];
  /** folded text for search, per matched verse / distinct phrase */
  foldedVerse: Map<string, string>;
  foldedPhrase: Map<string, string>;
}

// Harakat, Qur'anic annotation marks (small high letters, waqf signs, the
// dagger alef), tatweel and the extended-Arabic marks some scripts use.
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ࣓-ࣿ]/g;

/**
 * Folds Arabic text so a search typed on a normal keyboard, without harakat,
 * finds Uthmani text. Beyond the marks, it drops every alef and hamza (the
 * Uthmani spelling often leaves the alef out or writes it as a dagger alef or
 * a ى inside a word: ٱلۡكِتَٰبِ / الكتاب, يَتَوَفَّىٰكُمۡ / يتوفاكم) and the
 * spaces (some words are written joined: يَبۡنَؤُمَّ / يا ابن أم), and merges
 * the letters people type interchangeably (final ى/ي, ة/ه, and the
 * Persian-keyboard ی and ک).
 */
export function foldArabic(text: string): string {
  return text
    .replace(MARKS, "")
    .replace(/[ىی](?=[\u0622-\u064A])/g, "")
    .replace(/[اأإآٱٲٳءٔٵ]/g, "")
    .replace(/ؤ/g, "و")
    .replace(/[ئىیۍ]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ک/g, "ك")
    .replace(/[\s\u200c\u200d]+/g, "");
}

export const compareKeys = (a: { surah: number; ayah: number }, b: { surah: number; ayah: number }) =>
  a.surah - b.surah || a.ayah - b.ayah;

/** Single-word ranges are sometimes stored as [n]. */
const toRange = (r: number[]): WordRange => [r[0], r[1] ?? r[0]];

/**
 * Some phrase ranges in the source data sit a word or two off (phrase 1,
 * مِّن دُونِ ٱللَّهِ, is marked on دُونِ ٱللَّهِ لَا in 29:17). When the range
 * does not spell the phrase but a nearby one does, use that; and never let a
 * range run past the verse.
 */
function alignRange(words: string[], [from, to]: WordRange, folded: string): WordRange {
  const spells = (f: number) => foldArabic(words.slice(f - 1, f - 1 + to - from + 1).join(" ")) === folded;
  if (to <= words.length && spells(from)) return [from, to];
  for (const shift of [-1, 1, -2, 2]) {
    const f = from + shift;
    if (f >= 1 && f + to - from <= words.length && spells(f)) return [f, f + to - from];
  }
  return [Math.min(from, words.length), Math.min(to, words.length)];
}

function parseKey(key: string) {
  const [surah, ayah] = key.split(":").map(Number);
  return { surah, ayah };
}

export function buildBrowseIndex(
  pages: QuranPage[],
  phraseDetails: Record<string, MutashabihatPhrase>,
  similarDetails: Record<string, SimilarAyahEntry>,
  highlights: AyahHighlights
): BrowseIndex {
  const verses = new Map<string, BrowseVerse>();
  for (const page of pages) {
    for (const group of page.surahGroups) {
      for (const a of group.ayahs) {
        const key = `${a.surah}:${a.ayah}`;
        verses.set(key, {
          key,
          surah: a.surah,
          ayah: a.ayah,
          juz: page.juz,
          words: a.words.map((w) => w.text),
          phrases: [],
          similar: [],
        });
      }
    }
  }

  // The QUL data has near-duplicate phrases (orthographic variants,
  // overlapping phrases) covering the same verses: keep one per verse set,
  // with its longest text, and point the others at it.
  const phrases = new Map<string, BrowsePhrase>();
  const bySignature = new Map<string, BrowsePhrase>();
  const sortedPhrases = Object.values(phraseDetails).sort(
    (a, b) => b.phraseText.length - a.phraseText.length || Number(a.id) - Number(b.id)
  );
  for (const p of sortedPhrases) {
    const folded = foldArabic(p.phraseText);
    const occurrences = p.occurrences
      .filter((o) => verses.has(o.ayahKey))
      .map((o) => {
        const words = verses.get(o.ayahKey)!.words;
        const ranges = o.wordRanges.map((r) => alignRange(words, toRange(r), folded));
        return { key: o.ayahKey, ranges, ...parseKey(o.ayahKey) };
      })
      .sort(compareKeys);
    if (occurrences.length === 0) continue;
    const signature = occurrences.map((o) => o.key).join("|");
    const kept = bySignature.get(signature);
    if (kept) {
      phrases.set(p.id, kept);
      continue;
    }
    const phrase: BrowsePhrase = {
      id: p.id,
      text: p.phraseText,
      surahCount: new Set(occurrences.map((o) => o.surah)).size,
      occurrences: occurrences.map(({ key, ranges }) => ({ key, ranges })),
    };
    bySignature.set(signature, phrase);
    phrases.set(p.id, phrase);
    for (const o of phrase.occurrences) verses.get(o.key)!.phrases.push({ id: phrase.id, ranges: o.ranges });
  }
  const phraseList = [...bySignature.values()].sort(
    (a, b) => b.occurrences.length - a.occurrences.length || Number(a.id) - Number(b.id)
  );

  // Similar verses are listed under their source verse only; show each pair
  // from both sides. The source's matched words are its highlight ranges.
  const addSimilar = (key: string, other: VerseSimilar) => {
    const verse = verses.get(key);
    if (!verse || !verses.has(other.key) || other.key === key) return;
    const existing = verse.similar.find((s) => s.key === other.key);
    if (!existing) verse.similar.push(other);
    else if (other.score > existing.score) Object.assign(existing, other);
  };
  for (const entry of Object.values(similarDetails)) {
    const source = entry.sourceAyahKey;
    const sourceRanges =
      highlights[source]?.find((h) => h.type === "similar" && h.id === entry.id)?.wordRanges.map(toRange) ?? [];
    for (const m of entry.similarAyahs) {
      addSimilar(source, { key: m.ayahKey, score: m.score, words: m.matchedWordsCount, ranges: [toRange(m.matchWordsRange)] });
      addSimilar(m.ayahKey, { key: source, score: m.score, words: m.matchedWordsCount, ranges: sourceRanges });
    }
  }

  const matched: BrowseVerse[] = [];
  const bySurah = new Map<number, BrowseVerse[]>();
  for (const verse of verses.values()) {
    if (verse.phrases.length === 0 && verse.similar.length === 0) continue;
    verse.phrases.sort((a, b) => (a.ranges[0]?.[0] ?? 0) - (b.ranges[0]?.[0] ?? 0));
    verse.similar.sort((a, b) => b.score - a.score || compareKeys(parseKey(a.key), parseKey(b.key)));
    matched.push(verse);
  }
  matched.sort(compareKeys);
  for (const verse of matched) {
    if (!bySurah.has(verse.surah)) bySurah.set(verse.surah, []);
    bySurah.get(verse.surah)!.push(verse);
  }

  const foldedVerse = new Map(matched.map((v) => [v.key, foldArabic(v.words.join(" "))]));
  const foldedPhrase = new Map(phraseList.map((p) => [p.id, foldArabic(p.text)]));

  return { verses, matched, bySurah, phrases, phraseList, foldedVerse, foldedPhrase };
}

export interface BrowseSearchResult {
  surahs: SurahMeta[];
  /** a verse typed as "2:51" */
  verse: BrowseVerse | null;
  phrases: BrowsePhrase[];
  verses: BrowseVerse[];
}

const EMPTY: BrowseSearchResult = { surahs: [], verse: null, phrases: [], verses: [] };

const latinFold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Searches phrases and verses (Arabic, harakat optional), verse keys ("2:51",
 * "2") and surah names (Arabic or transliterated).
 */
export function searchBrowse(index: BrowseIndex, surahs: SurahMeta[], query: string): BrowseSearchResult {
  const q = query.trim();
  if (!q) return EMPTY;

  const keyMatch = q.match(/^(\d{1,3})(?:\s*[:：.]\s*(\d{1,3}))?$/);
  if (keyMatch) {
    const surah = surahs.find((s) => s.index === Number(keyMatch[1]));
    const verse = keyMatch[2] ? index.verses.get(`${keyMatch[1]}:${Number(keyMatch[2])}`) ?? null : null;
    return { ...EMPTY, surahs: surah ? [surah] : [], verse };
  }

  if (!/[؀-ۿ]/.test(q)) {
    const lq = latinFold(q);
    if (!lq) return EMPTY;
    return {
      ...EMPTY,
      surahs: surahs.filter((s) => latinFold(s.tname).includes(lq) || latinFold(s.ename).includes(lq)),
    };
  }

  const fq = foldArabic(q);
  if (!fq) return EMPTY;
  return {
    surahs: surahs.filter((s) => foldArabic(s.name).includes(fq)),
    verse: null,
    phrases: index.phraseList.filter((p) => index.foldedPhrase.get(p.id)!.includes(fq)),
    verses: index.matched.filter((v) => index.foldedVerse.get(v.key)!.includes(fq)),
  };
}

/** The words of `words` that a folded search `folded` falls on, as ranges. */
export function matchRanges(words: string[], folded: string): WordRange[] {
  if (!folded) return [];
  const starts: number[] = [];
  let text = "";
  for (const w of words) {
    starts.push(text.length);
    text += foldArabic(w);
  }
  const wordAt = (offset: number) => {
    let i = starts.length - 1;
    while (i > 0 && starts[i] > offset) i--;
    return i + 1;
  };
  const out: WordRange[] = [];
  for (let i = text.indexOf(folded); i !== -1; i = text.indexOf(folded, i + folded.length)) {
    out.push([wordAt(i), wordAt(i + folded.length - 1)]);
  }
  return out;
}
