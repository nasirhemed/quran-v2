import type { MutashabihatPhrase, QuranPage, SimilarAyahEntry } from "@/types";
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

export interface PracticeRange {
  type: "juz" | "surah";
  from: number;
  to: number;
}

export interface PracticeConfig {
  range: PracticeRange;
  mode: "drill" | "similar" | "random";
  count: number;
  skipSameSurah: boolean;
  skipHugeGroups: boolean;
  usePhrases: boolean;
  useSimilarAyahs: boolean;
}

/** A drill walks at most this many verses of one group when the huge-group gate is on. */
export const HUGE_GROUP_LIMIT = 10;

export interface GroupOccurrence {
  key: string;
  /** 1-indexed word ranges of the shared/matched segment in this ayah. */
  ranges?: [number, number][];
}

/** A confusable group, from either data source, in one shape. */
export interface PracticeGroup {
  id: string;
  phraseText?: string;
  occurrences: GroupOccurrence[];
  surahCount: number;
}

export interface PracticeTwin {
  key: string;
  tname: string;
  text: string;
  ranges?: [number, number][];
}

export interface PracticeQuestion {
  key: string;
  surah: number;
  ayah: number;
  tname: string;
  hint: string;
  fullText: string;
  /** Word ranges of the shared segment in the prompt ayah. */
  promptRanges?: [number, number][];
  /** Other occurrences of the group (twins mode only — drills don't spoil). */
  twins: PracticeTwin[];
  /** The shared phrase being tested (phrase-sourced groups). */
  phraseText?: string;
  /** The ayah after the prompt, for recall context (drill and random modes). */
  nextAyahText?: string;
  /** Group walk position (drill mode only). */
  groupNumber?: number;
  groupPosition?: number;
  groupSize?: number;
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

function inRange(info: AyahInfo | undefined, range: PracticeRange): boolean {
  if (!info) return false;
  const value = range.type === "juz" ? info.juz : info.surah;
  return value >= range.from && value <= range.to;
}

function countSurahs(occurrences: GroupOccurrence[]): number {
  return new Set(occurrences.map((o) => parseVerseKey(o.key).surah)).size;
}

// ─── Group builders ─────────────────────────────────────────────

function groupsFromPhrases(
  details: Record<string, MutashabihatPhrase>
): PracticeGroup[] {
  const groups: PracticeGroup[] = [];
  for (const phrase of Object.values(details)) {
    const byKey = new Map<string, GroupOccurrence>();
    for (const occ of phrase.occurrences) {
      if (!byKey.has(occ.ayahKey)) {
        byKey.set(occ.ayahKey, { key: occ.ayahKey, ranges: occ.wordRanges });
      }
    }
    groups.push({
      id: `phrase:${phrase.id}`,
      phraseText: phrase.phraseText,
      occurrences: [...byKey.values()],
      surahCount: phrase.surahCount,
    });
  }
  return groups;
}

function groupsFromSimilarAyahs(
  details: Record<string, SimilarAyahEntry>
): PracticeGroup[] {
  const groups: PracticeGroup[] = [];
  for (const entry of Object.values(details)) {
    const byKey = new Map<string, GroupOccurrence>();
    byKey.set(entry.sourceAyahKey, { key: entry.sourceAyahKey });
    for (const m of entry.similarAyahs) {
      if (!byKey.has(m.ayahKey)) {
        byKey.set(m.ayahKey, { key: m.ayahKey, ranges: [m.matchWordsRange] });
      }
    }
    const occurrences = [...byKey.values()];
    groups.push({
      id: `similar:${entry.id}`,
      occurrences,
      surahCount: countSurahs(occurrences),
    });
  }
  return groups;
}

/**
 * Merge groups whose occurrence sets are identical — the QUL data contains
 * near-duplicate phrase entries (orthographic variants, overlapping phrases
 * of the same verse set) that would otherwise repeat as questions. The entry
 * with a phrase text (longest wins) represents the merged group.
 */
export function dedupeGroups(groups: PracticeGroup[]): PracticeGroup[] {
  const bySig = new Map<string, PracticeGroup>();
  for (const g of groups) {
    const sig = g.occurrences
      .map((o) => o.key)
      .sort()
      .join("|");
    const existing = bySig.get(sig);
    if (
      !existing ||
      (g.phraseText?.length ?? 0) > (existing.phraseText?.length ?? 0)
    ) {
      bySig.set(sig, g);
    }
  }
  return [...bySig.values()];
}

export function buildPracticeGroups(
  phraseDetails: Record<string, MutashabihatPhrase> | undefined,
  similarDetails: Record<string, SimilarAyahEntry> | undefined,
  config: PracticeConfig
): PracticeGroup[] {
  const groups: PracticeGroup[] = [];
  if (config.usePhrases && phraseDetails) {
    groups.push(...groupsFromPhrases(phraseDetails));
  }
  if (config.useSimilarAyahs && similarDetails) {
    groups.push(...groupsFromSimilarAyahs(similarDetails));
  }
  return dedupeGroups(groups);
}

// ─── Question generators ────────────────────────────────────────

function toQuestion(
  occ: GroupOccurrence,
  info: AyahInfo,
  group: PracticeGroup
): PracticeQuestion {
  return {
    key: occ.key,
    surah: info.surah,
    ayah: info.ayah,
    tname: info.tname,
    hint: makeHint(info.text),
    fullText: info.text,
    promptRanges: occ.ranges,
    twins: [],
    phraseText: group.phraseText,
  };
}

/**
 * The original memorization app's "Similar Verses" mode: pick confusable
 * groups, then quiz EVERY in-range occurrence of each group back to back.
 * Whole groups are kept together, so the total may exceed config.count.
 */
export function generateGroupDrillQuestions(
  groups: PracticeGroup[],
  index: AyahIndex,
  config: PracticeConfig
): PracticeQuestion[] {
  const eligible: { group: PracticeGroup; occs: GroupOccurrence[] }[] = [];

  for (const group of groups) {
    if (config.skipSameSurah && group.surahCount < 2) continue;
    const occs = group.occurrences.filter((o) =>
      inRange(index.get(o.key), config.range)
    );
    if (occs.length < 2) continue; // a drill needs at least two in range
    if (config.skipHugeGroups && occs.length > HUGE_GROUP_LIMIT) continue;
    eligible.push({ group, occs });
  }

  const questions: PracticeQuestion[] = [];
  let groupNumber = 0;

  for (const { group, occs } of shuffle(eligible)) {
    if (questions.length >= config.count) break;
    groupNumber++;
    const members = shuffle(occs);

    members.forEach((occ, i) => {
      const info = index.get(occ.key)!;
      const next = index.get(`${info.surah}:${info.ayah + 1}`);
      questions.push({
        ...toQuestion(occ, info, group),
        nextAyahText: next?.text,
        groupNumber,
        groupPosition: i + 1,
        groupSize: members.length,
      });
    });
  }

  return questions;
}

/**
 * One prompt per group; all other occurrences revealed together as twins.
 */
export function generateTwinsQuestions(
  groups: PracticeGroup[],
  index: AyahIndex,
  config: PracticeConfig
): PracticeQuestion[] {
  const candidates: PracticeQuestion[] = [];

  for (const group of groups) {
    if (config.skipSameSurah && group.surahCount < 2) continue;
    if (group.occurrences.length < 2) continue;

    const inRangeOccs = group.occurrences.filter((o) =>
      inRange(index.get(o.key), config.range)
    );
    if (inRangeOccs.length === 0) continue;

    const prompt = inRangeOccs[Math.floor(Math.random() * inRangeOccs.length)];
    const info = index.get(prompt.key)!;
    const twins: PracticeTwin[] = group.occurrences
      .filter((o) => o.key !== prompt.key)
      .map((o) => {
        const t = index.get(o.key);
        return {
          key: o.key,
          tname: t?.tname ?? "",
          text: t?.text ?? "",
          ranges: o.ranges,
        };
      });

    candidates.push({ ...toQuestion(prompt, info, group), twins });
  }

  return shuffle(candidates).slice(0, config.count);
}

export function generateRandomQuestions(
  index: AyahIndex,
  config: PracticeConfig
): PracticeQuestion[] {
  const keys: string[] = [];
  for (const [key, info] of index) {
    if (inRange(info, config.range)) keys.push(key);
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
