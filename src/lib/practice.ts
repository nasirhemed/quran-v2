import type { MutashabihatPhrase, QuranPage } from "@/types";
import { parseVerseKey } from "@/lib/quranMeta";

export interface AyahInfo {
  surah: number;
  ayah: number;
  juz: number;
  page: number;
  tname: string;
  text: string;
}

export type AyahIndex = Map<string, AyahInfo>;

export interface PracticeConfig {
  juzFrom: number;
  juzTo: number;
  mode: "similar" | "random";
  count: number;
  skipSameSurah: boolean;
}

export interface PracticeTwin {
  key: string;
  tname: string;
  text: string;
}

export interface PracticeQuestion {
  key: string;
  surah: number;
  ayah: number;
  tname: string;
  hint: string;
  fullText: string;
  /** Other occurrences of the same phrase group (similar mode only). */
  twins: PracticeTwin[];
  /** The shared phrase being tested (similar mode only). */
  phraseText?: string;
  /** The ayah after the prompt, for recall context (random mode only). */
  nextAyahText?: string;
}

const HINT_WORDS = 5;

export function buildAyahIndex(pages: QuranPage[]): AyahIndex {
  const index: AyahIndex = new Map();
  for (const page of pages) {
    for (const group of page.surahGroups) {
      for (const a of group.ayahs) {
        index.set(`${a.surah}:${a.ayah}`, {
          surah: a.surah,
          ayah: a.ayah,
          juz: page.juz,
          page: page.pageNumber,
          tname: group.tname,
          text: a.words.map((w) => w.text).join(" "),
        });
      }
    }
  }
  return index;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function makeHint(text: string): string {
  return text.split(" ").slice(0, HINT_WORDS).join(" ");
}

function inRange(info: AyahInfo | undefined, config: PracticeConfig): boolean {
  return !!info && info.juz >= config.juzFrom && info.juz <= config.juzTo;
}

/**
 * Questions from the curated mutashabihat groups: the prompt is an in-range
 * occurrence of a phrase; its twins are the other occurrences. Quality gate:
 * groups confined to a single surah are skipped unless the user opts in.
 */
export function generateSimilarQuestions(
  details: Record<string, MutashabihatPhrase>,
  index: AyahIndex,
  config: PracticeConfig
): PracticeQuestion[] {
  const candidates: PracticeQuestion[] = [];

  for (const phrase of Object.values(details)) {
    if (config.skipSameSurah && phrase.surahCount < 2) continue;
    if (phrase.occurrences.length < 2) continue;

    const inRangeOccs = phrase.occurrences.filter((o) =>
      inRange(index.get(o.ayahKey), config)
    );
    if (inRangeOccs.length === 0) continue;

    const prompt = inRangeOccs[Math.floor(Math.random() * inRangeOccs.length)];
    const info = index.get(prompt.ayahKey)!;
    const twins: PracticeTwin[] = phrase.occurrences
      .filter((o) => o.ayahKey !== prompt.ayahKey)
      .map((o) => {
        const t = index.get(o.ayahKey);
        return {
          key: o.ayahKey,
          tname: t?.tname ?? "",
          text: t?.text ?? o.ayahText,
        };
      });

    candidates.push({
      key: prompt.ayahKey,
      surah: info.surah,
      ayah: info.ayah,
      tname: info.tname,
      hint: makeHint(info.text),
      fullText: info.text,
      twins,
      phraseText: phrase.phraseText,
    });
  }

  return shuffle(candidates).slice(0, config.count);
}

export function generateRandomQuestions(
  index: AyahIndex,
  config: PracticeConfig
): PracticeQuestion[] {
  const keys: string[] = [];
  for (const [key, info] of index) {
    if (inRange(info, config)) keys.push(key);
  }

  return shuffle(keys)
    .slice(0, config.count)
    .map((key) => {
      const info = index.get(key)!;
      const { surah, ayah } = parseVerseKey(key);
      const next = index.get(`${surah}:${ayah + 1}`);
      return {
        key,
        surah,
        ayah,
        tname: info.tname,
        hint: makeHint(info.text),
        fullText: info.text,
        twins: [],
        nextAyahText: next?.text,
      };
    });
}
