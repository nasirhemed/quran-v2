// ─── Page data ──────────────────────────────────────────────────

export interface QuranWord {
  text: string;
  lineNumber: number;
  position: number; // 1-indexed position in ayah
  charType?: "word" | "end"; // stripped from shipped data; only "word" entries survive the pipeline
}

export interface PageAyah {
  surah: number;
  ayah: number;
  words: QuranWord[];
}

export interface PageSurahGroup {
  surahIndex: number;
  surahName: string;
  tname: string;
  isSurahStart: boolean;
  bismillah: string | null;
  ayahs: PageAyah[];
}

export interface QuranPage {
  pageNumber: number;
  juz: number;
  surahGroups: PageSurahGroup[];
}

// ─── Surah / Juz metadata ───────────────────────────────────────

export interface SurahMeta {
  index: number;
  name: string;
  tname: string;
  ename: string;
  ayas: number;
  type: string;
  order: number;
  startPage: number;
}

export interface JuzMeta {
  index: number;
  sura: number;
  aya: number;
  startPage: number;
}

// ─── Highlight data ─────────────────────────────────────────────

export interface HighlightEntry {
  type: "phrase" | "similar";
  id: string;
  wordRanges: [number, number][];
}

export type AyahHighlights = Record<string, HighlightEntry[]>;

// ─── Mutashabihat details ───────────────────────────────────────

export interface MutashabihatOccurrence {
  ayahKey: string;
  ayahText: string;
  wordRanges: [number, number][];
}

export interface MutashabihatPhrase {
  id: string;
  phraseText: string;
  surahCount: number;
  ayahCount: number;
  totalOccurrences: number;
  sourceAyah: string;
  sourceWordRange: [number, number];
  occurrences: MutashabihatOccurrence[];
}

// ─── Similar ayah details ───────────────────────────────────────

export interface SimilarAyahMatch {
  ayahKey: string;
  ayahText: string;
  matchedWordsCount: number;
  coverage: number;
  score: number;
  matchWordsRange: [number, number];
}

export interface SimilarAyahEntry {
  id: string;
  sourceAyahKey: string;
  sourceAyahText: string;
  similarAyahs: SimilarAyahMatch[];
}

// ─── Browse list data (from Quran-Practice exports) ─────────────

export interface PhraseListItem {
  id: string;
  phraseText: string;
  surahCount: number;
  ayahCount: number;
  totalOccurrences: number;
  sourceAyah: string;
  occurrences: string[]; // verse keys "surah:ayah"
  occurrencePhraseTexts: Record<string, string>;
  occurrenceAyahPreviews: Record<string, string>;
}

export interface SimilarAyahListItem {
  id: string;
  primaryVerseKey: string;
  sourceAyahText: string;
  occurrences: string[];
  totalSimilarCount: number;
}

// ─── Computed highlight for rendering ───────────────────────────

export interface WordHighlight {
  type: "phrase" | "similar";
  id: string;
  colorIndex: number;
}

export interface PageHighlightMap {
  // key: "surah:ayah", value: map of wordIndex (0-based) -> highlight info
  [ayahKey: string]: Map<number, WordHighlight>;
}

// ─── Local phrases ──────────────────────────────────────────────

export interface LocalPhrase {
  id: string;
  phraseText: string;
  sourceAyah: string;
  sourceWordRange: [number, number]; // 1-indexed
  occurrences: { ayahKey: string; wordRange: [number, number] }[];
  createdAt: number;
}

export interface WordSelection {
  ayahKey: string;
  startWord: number;
  endWord: number | null; // 1-indexed
}

// ─── Side panel ─────────────────────────────────────────────────

export type SidePanelContent =
  | { type: "phrase"; phraseId: string }
  | { type: "similar"; ayahKey: string }
  | { type: "local-phrase"; phraseId: string }
  | null;
