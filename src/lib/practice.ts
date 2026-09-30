import type { QuranPage, SimilarAyahEntry } from "@/types";
import { foldArabic } from "@/lib/browse";
import { parseVerseKey } from "@/lib/quranMeta";

export interface AyahInfo {
  surah: number;
  ayah: number;
  juz: number;
  page: number;
  tname: string;
  text: string;
  words: string[];
  /** `words` folded (no harakat, alef or hamza), for comparing verses word by word. */
  folded: string[];
}

export type AyahIndex = Map<string, AyahInfo>;

export interface PracticeRange {
  type: "juz" | "surah";
  from: number;
  to: number;
}

export type PracticeMode = "similar" | "competition";

export interface PracticeConfig {
  range: PracticeRange;
  mode: PracticeMode;
  count: number;
}

export type WordRange = [number, number];

/** Groups with more in-range verses than this are skipped: formulas, not look-alikes. */
export const HUGE_GROUP_LIMIT = 10;
/** Two verses are look-alikes only if they share at least this many words, in order. */
const MIN_SHARED_WORDS = 3;
/** Prompt length when the verse's opening is its own. */
const HINT_WORDS = 3;
/** Competition prompts grow from this many words until they point to one place. */
const MIN_PROMPT_WORDS = 3;
const MAX_PROMPT_WORDS = 8;
const MAX_LOOK_ALIKES = 3;

/** A group of verses that look alike, from the similar-ayah data. */
export interface PracticeGroup {
  id: string;
  keys: string[];
  surahCount: number;
}

export interface PracticeTwin {
  key: string;
  tname: string;
  words: string[];
  /** Words where this verse differs from the verse it is shown with. */
  marks: WordRange[];
}

export interface PracticeQuestion {
  key: string;
  surah: number;
  ayah: number;
  tname: string;
  /** The words shown as the prompt. */
  hint: string;
  /** The prompt starts mid-verse. */
  midVerse: boolean;
  /** The prompt's words are found in more than one place (competition): any of them counts. */
  ambiguous: boolean;
  /** Keep the surah and ayah hidden until the reveal (competition). */
  hideLocation: boolean;
  words: string[];
  /** Words to mark in the revealed verse: where it differs (similar), or the prompt (competition). */
  marks: WordRange[];
  /** How many other verses open with the shown words (similar, when the prompt is a shared opening). */
  sameOpening: number;
  /**
   * The verse's look-alikes, differences marked. A group walk reveals them on
   * its last verse only, so the earlier ones are not given away.
   */
  lookAlikes: PracticeTwin[];
  nextAyahText?: string;
  /** Group walk position (similar mode; dropped when a missed verse is retried on its own). */
  groupNumber?: number;
  groupPosition?: number;
  groupSize?: number;
}

export function buildAyahIndex(pages: QuranPage[]): AyahIndex {
  const index: AyahIndex = new Map();
  for (const page of pages) {
    for (const group of page.surahGroups) {
      for (const a of group.ayahs) {
        const words = a.words.map((w) => w.text);
        index.set(`${a.surah}:${a.ayah}`, {
          surah: a.surah,
          ayah: a.ayah,
          juz: page.juz,
          page: page.pageNumber,
          tname: group.tname,
          text: words.join(" "),
          words,
          folded: words.map(foldArabic),
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

function inRange(info: AyahInfo | undefined, range: PracticeRange): boolean {
  if (!info) return false;
  const value = range.type === "juz" ? info.juz : info.surah;
  return value >= range.from && value <= range.to;
}

// ─── Word diff ──────────────────────────────────────────────────

/** For each word of `a`: is it part of a longest common word subsequence with `b`? */
export function matchedWords(a: string[], b: string[]): boolean[] {
  const n = a.length;
  const m = b.length;
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    }
  }
  const matched = new Array<boolean>(n).fill(false);
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      matched[i] = true;
      i++;
      j++;
    } else if (t[i + 1][j] >= t[i][j + 1]) i++;
    else j++;
  }
  return matched;
}

const sharedCount = (a: string[], b: string[]) => matchedWords(a, b).filter(Boolean).length;

/** 1-indexed runs of the words of `a` that `b` does not share. */
export function differingRanges(a: string[], b: string[]): WordRange[] {
  const ranges: WordRange[] = [];
  matchedWords(a, b).forEach((m, i) => {
    if (m) return;
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i + 1, i + 1]);
  });
  return ranges;
}

export function commonPrefix(a: string[], b: string[]): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
}

const withoutConjunction = (w: string) => w.replace(/^[وف]/, "");

/**
 * How many words two verses open with alike: a common prefix, except that the
 * first word may differ by a leading وَ or فَ (ٱلَّذِينَ هُمْ عَلَىٰ صَلَاتِهِمْ /
 * وَٱلَّذِينَ هُمْ عَلَىٰ صَلَاتِهِمْ).
 */
export function sharedOpening(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  if (a[0] !== b[0] && withoutConjunction(a[0]) !== withoutConjunction(b[0])) return 0;
  return 1 + commonPrefix(a.slice(1), b.slice(1));
}

/** The other verse most like `info`, and where `info` differs from it. */
function closestDiff(info: AyahInfo, others: AyahInfo[]): WordRange[] {
  let best: AyahInfo | undefined;
  let bestShared = -1;
  for (const o of others) {
    const shared = sharedCount(info.folded, o.folded);
    if (shared > bestShared) {
      best = o;
      bestShared = shared;
    }
  }
  return best ? differingRanges(info.folded, best.folded) : [];
}

// ─── Groups ─────────────────────────────────────────────────────

/**
 * One group per similar-ayah entry: its source and every listed verse sharing
 * at least MIN_SHARED_WORDS words with it (the data also pairs verses that
 * only share ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ). A refrain (the same words over and over in
 * one surah) has nothing to tell apart and is left out.
 */
export function buildSimilarGroups(
  details: Record<string, SimilarAyahEntry>,
  index: AyahIndex
): PracticeGroup[] {
  const groups: PracticeGroup[] = [];
  for (const entry of Object.values(details)) {
    const source = index.get(entry.sourceAyahKey);
    if (!source) continue;
    const keys = [entry.sourceAyahKey];
    for (const m of entry.similarAyahs) {
      const t = index.get(m.ayahKey);
      if (!t || keys.includes(m.ayahKey)) continue;
      if (sharedCount(source.folded, t.folded) >= MIN_SHARED_WORDS) keys.push(m.ayahKey);
    }
    if (keys.length < 2) continue;
    const surahCount = new Set(keys.map((k) => parseVerseKey(k).surah)).size;
    const texts = new Set(keys.map((k) => index.get(k)!.folded.join(" ")));
    if (surahCount < 2 && texts.size < 2) continue;
    groups.push({ id: entry.id, keys, surahCount });
  }
  return dedupeGroups(groups);
}

/** Merge groups with the same verses (A lists B and B lists A). */
export function dedupeGroups(groups: PracticeGroup[]): PracticeGroup[] {
  const bySig = new Map<string, PracticeGroup>();
  for (const g of groups) {
    const sig = [...g.keys].sort().join("|");
    if (!bySig.has(sig)) bySig.set(sig, g);
  }
  return [...bySig.values()];
}

// ─── Similar verses ─────────────────────────────────────────────

/**
 * The prompt for one verse of a group. When it opens like a look-alike, show
 * that shared opening and stop where they part: the next
 * word is the test. Otherwise the first few words.
 */
function similarPrompt(info: AyahInfo, others: AyahInfo[]): { words: number; sameOpening: number } {
  const prefixes = others.map((o) => sharedOpening(info.folded, o.folded));
  const shared = Math.min(Math.max(0, ...prefixes), info.words.length - 1);
  if (shared >= 2) {
    return { words: shared, sameOpening: prefixes.filter((p) => p >= shared).length };
  }
  return { words: Math.max(1, Math.min(HINT_WORDS, info.words.length - 1)), sameOpening: 0 };
}

const twin = (info: AyahInfo, marks: WordRange[]): PracticeTwin => ({
  key: `${info.surah}:${info.ayah}`,
  tname: info.tname,
  words: info.words,
  marks,
});

/**
 * Walk every in-range verse of a group back to back (the original
 * memorization app's "Similar Verses" mode), without showing the others
 * until the group's last verse, whose answer lays the whole group side by
 * side with the differences marked. Whole groups are kept together, so the
 * total may exceed config.count.
 */
export function generateSimilarQuestions(
  groups: PracticeGroup[],
  index: AyahIndex,
  config: PracticeConfig
): PracticeQuestion[] {
  const eligible: { members: AyahInfo[]; inRange: AyahInfo[] }[] = [];
  for (const g of groups) {
    const members = g.keys.map((k) => index.get(k)!);
    const walk = members.filter((m) => inRange(m, config.range));
    if (walk.length < 2 && !(walk.length === 1 && g.surahCount > 1)) continue;
    if (walk.length > HUGE_GROUP_LIMIT) continue;
    eligible.push({ members, inRange: walk });
  }

  const questions: PracticeQuestion[] = [];
  const asked = new Set<AyahInfo>();
  let groupNumber = 0;
  for (const { members, inRange: walk } of shuffle(eligible)) {
    if (questions.length >= config.count) break;
    // Verses can belong to several groups; ask each once a session.
    const order = shuffle(walk.filter((m) => !asked.has(m)));
    if (order.length === 0) continue;
    order.forEach((m) => asked.add(m));
    groupNumber++;
    order.forEach((info, i) => {
      const others = members.filter((m) => m !== info);
      const prompt = similarPrompt(info, others);
      const next = index.get(`${info.surah}:${info.ayah + 1}`);
      questions.push({
        key: `${info.surah}:${info.ayah}`,
        surah: info.surah,
        ayah: info.ayah,
        tname: info.tname,
        hint: info.words.slice(0, prompt.words).join(" "),
        midVerse: false,
        ambiguous: false,
        hideLocation: false,
        words: info.words,
        marks: closestDiff(info, others),
        sameOpening: prompt.sameOpening,
        lookAlikes: others.map((o) => twin(o, closestDiff(o, members.filter((m) => m !== o)))),
        nextAyahText: next?.text,
        groupNumber,
        groupPosition: i + 1,
        groupSize: order.length,
      });
    });
  }
  return questions;
}

// ─── Competition ────────────────────────────────────────────────

const corpora = new WeakMap<AyahIndex, string>();

/** Every folded word of the Qur'an in order, space-separated and space-padded. */
function corpus(index: AyahIndex): string {
  let c = corpora.get(index);
  if (!c) {
    const words: string[] = [];
    for (const info of index.values()) words.push(...info.folded);
    c = ` ${words.join(" ")} `;
    corpora.set(index, c);
  }
  return c;
}

function occursOnce(haystack: string, words: string[]): boolean {
  const needle = ` ${words.join(" ")} `;
  const first = haystack.indexOf(needle);
  return first !== -1 && haystack.indexOf(needle, first + 1) === -1;
}

/**
 * A judge's prompt: from `start`, the fewest words (at least
 * MIN_PROMPT_WORDS) found in only one place in the Qur'an, leaving at least
 * one word of the verse to recite. Null if no such prompt exists.
 */
export function uniquePrompt(info: AyahInfo, start: number, haystack: string): number | null {
  const room = info.words.length - start - 1;
  for (let k = MIN_PROMPT_WORDS; k <= Math.min(MAX_PROMPT_WORDS, room); k++) {
    if (occursOnce(haystack, info.folded.slice(start, start + k))) return k;
  }
  return null;
}

/**
 * Judge-style questions: a few words from a random point in the range, often
 * mid-verse, with the place hidden; recite on to the end of the next verse.
 * Half the start points are in verses that have a look-alike, where a
 * contestant is most likely to slip into the other verse.
 */
export function generateCompetitionQuestions(
  groups: PracticeGroup[],
  index: AyahIndex,
  config: PracticeConfig
): PracticeQuestion[] {
  const haystack = corpus(index);
  const groupsOf = new Map<string, PracticeGroup[]>();
  for (const g of groups) {
    for (const k of g.keys) groupsOf.set(k, [...(groupsOf.get(k) ?? []), g]);
  }

  const keys = [...index.keys()].filter(
    (k) => inRange(index.get(k), config.range) && index.get(k)!.words.length > MIN_PROMPT_WORDS
  );
  const risky = shuffle(keys.filter((k) => groupsOf.has(k)));
  const plain = shuffle(keys.filter((k) => !groupsOf.has(k)));
  const wantRisky = Math.ceil(config.count / 2);
  const picked = [
    ...risky.slice(0, Math.max(wantRisky, config.count - plain.length)),
    ...plain.slice(0, Math.max(config.count - wantRisky, config.count - risky.length)),
  ];

  const questions: PracticeQuestion[] = [];
  for (const key of shuffle(picked)) {
    const info = index.get(key)!;
    let start = 0;
    if (info.words.length >= 6 && Math.random() < 0.5) {
      start = 1 + Math.floor(Math.random() * (info.words.length - MIN_PROMPT_WORDS - 1));
    }
    let len = uniquePrompt(info, start, haystack);
    if (len === null && start > 0) {
      start = 0;
      len = uniquePrompt(info, 0, haystack);
    }
    // A verse whose opening recurs word for word elsewhere: the judge reads on
    // until it could only be this one, or as far as the verse allows.
    const ambiguous = len === null;
    if (len === null) len = Math.min(MAX_PROMPT_WORDS, info.words.length - 1);

    const members = new Set<string>();
    for (const g of groupsOf.get(key) ?? []) for (const k of g.keys) members.add(k);
    members.delete(key);
    const lookAlikes = [...members]
      .map((k) => index.get(k)!)
      .map((o) => ({ o, shared: sharedCount(info.folded, o.folded) }))
      .sort((a, b) => b.shared - a.shared)
      .slice(0, MAX_LOOK_ALIKES)
      .map(({ o }) => twin(o, differingRanges(o.folded, info.folded)));

    const next = index.get(`${info.surah}:${info.ayah + 1}`);
    questions.push({
      key,
      surah: info.surah,
      ayah: info.ayah,
      tname: info.tname,
      hint: info.words.slice(start, start + len).join(" "),
      midVerse: start > 0,
      ambiguous,
      hideLocation: true,
      words: info.words,
      marks: [[start + 1, start + len]],
      sameOpening: 0,
      lookAlikes,
      nextAyahText: next?.text,
    });
  }
  return questions;
}
