import type { MutashabihatPhrase, QuranPage, SimilarAyahEntry } from "@/types";
import { MARKS } from "@/lib/browse";

/**
 * Practice is modelled on how Qur'an competitions test memorization: the
 * judge reads the opening words of a verse and the contestant recites on, a
 * page or so, and judges like to start where the verse has a look-alike
 * elsewhere (drifting into the look-alike is the classic slip). So a question
 * here is a start verse plus the passage after it, to the end of the next
 * page, and both are chosen where look-alikes cluster.
 *
 * How alike two verses are is measured on their words, not taken from the
 * similar-ayah scores (which rate a one-word verse like الٓمٓ a perfect match):
 * the words they share in order, each weighted by how rare it is in the
 * Qur'an, with a bonus for a shared opening and for short verses that are
 * nearly all shared. Stock phrases (ٱلۡحَمۡدُ لِلَّهِ
 * رَبِّ ٱلۡعَٰلَمِينَ) come out weak, real look-alikes (2:58 and 7:161) strong.
 * Candidate pairs come from the QUL data and from rare three-word runs the
 * verses share, which finds pairs the data misses (20:10 and 28:29).
 */

export interface PracticeVerse {
  key: string;
  surah: number;
  ayah: number;
  page: number;
  juz: number;
  tname: string;
  /** word texts, in the page data's segmentation */
  words: string[];
}

export interface LookAlike {
  /** the other verse, as an index into PracticeIndex.verses */
  other: number;
  /** 0–1: how easily reciting one verse slides into the other */
  strength: number;
}

export interface PracticeIndex {
  /** every verse, in mushaf order */
  verses: PracticeVerse[];
  /** verse key → index into `verses` */
  at: Map<string, number>;
  /** per verse: its look-alikes, strongest first */
  lookAlikes: LookAlike[][];
  /** per verse: how confusable it is (its strongest look-alike, plus a little for each further one) */
  trap: Float64Array;
  /** per verse: word ids after folding away harakat and marks, for alignment */
  ids: Int32Array[];
}

export interface PracticeRange {
  type: "juz" | "surah";
  from: number;
  to: number;
}

export interface PracticeQuestion {
  /** the start verse (index into PracticeIndex.verses) */
  start: number;
  /** the passage's last verse: the end of the page after the start's, or of the range */
  end: number;
  key: string;
  /** opening words of the start verse that make up the prompt */
  promptWords: number;
  /** how many of the passage's verses have a look-alike worth showing */
  traps: number;
}

/** Below this, two verses don't count as look-alikes at all. */
const MIN_STRENGTH = 0.15;
/** Look-alikes this strong are shown when a passage is checked, and count as traps. */
export const SHOW_STRENGTH = 0.4;
/** A question starts on a verse at least this confusable, while there are any. */
const START_TRAP = 0.4;
/** The start verse counts this much more than the rest of the passage. */
const START_WEIGHT = 2;
/** The fewest opening words in a prompt, as in competitions (5–7 words, or more to tell look-alikes apart). */
export const PROMPT_WORDS = 5;
/** A QUL phrase in more verses than this is a stock phrase, not a sign of look-alikes. */
const MAX_PHRASE_VERSES = 10;
/** Likewise a run of three words. */
const MAX_TRIGRAM_VERSES = 12;

// ─── Words ──────────────────────────────────────────────────────

/**
 * Folds a word for comparison, so words that sound the same compare equal: no harakat, Qur'anic marks or waqf
 * signs, and the spellings the mushaf varies without a change in sound merged (the dagger alef and alef of
 * بِظَلَّٰمٖ / بِظَلَّامٖ, the ة and ت of نِعۡمَةَ / نِعۡمَتَ, alef wasla). أ and إ stay apart: إِنَّ and أَنَّ differ.
 */
export function foldWord(word: string): string {
  return word
    .replace(/\u0670/g, "ا")
    .replace(MARKS, "")
    .replace(/\s+/g, "")
    .replace(/[ٱآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ت");
}

/** Word-level longest common subsequence: the aligned positions, as [i, j] pairs. */
export function alignWords(a: ArrayLike<number>, b: ArrayLike<number>): [number, number][] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] === b[j]) out.push([i++, j++]);
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return out;
}

// ─── Index ──────────────────────────────────────────────────────

export function buildPracticeIndex(
  pages: QuranPage[],
  phraseDetails?: Record<string, MutashabihatPhrase>,
  similarDetails?: Record<string, SimilarAyahEntry>
): PracticeIndex {
  const verses: PracticeVerse[] = [];
  for (const page of pages) {
    for (const group of page.surahGroups) {
      for (const a of group.ayahs) {
        verses.push({
          key: `${a.surah}:${a.ayah}`,
          surah: a.surah,
          ayah: a.ayah,
          page: page.pageNumber,
          juz: page.juz,
          tname: group.tname,
          words: a.words.map((w) => w.text),
        });
      }
    }
  }
  const at = new Map(verses.map((v, i) => [v.key, i]));

  // Word ids (one per folded word; each spelling is folded once), how rare
  // each word is, and a looser id that ignores a leading و/ف (وَإِذۡ and إِذۡ
  // open the same way).
  const idOfText = new Map<string, number>();
  const wordId = new Map<string, number>();
  const looseId = new Map<string, number>();
  const looseOf: number[] = [];
  const idOf = (text: string) => {
    let id = idOfText.get(text);
    if (id === undefined) {
      const folded = foldWord(text);
      id = wordId.get(folded);
      if (id === undefined) {
        id = wordId.size;
        wordId.set(folded, id);
        const l = folded.length > 2 ? folded.replace(/^[وف]/, "") : folded;
        if (!looseId.has(l)) looseId.set(l, looseId.size);
        looseOf.push(looseId.get(l)!);
      }
      idOfText.set(text, id);
    }
    return id;
  };
  const ids = verses.map((v) => Int32Array.from(v.words, idOf));
  const loose = ids.map((a) => a.map((id) => looseOf[id]));
  const df = new Float64Array(wordId.size);
  for (const a of ids) for (const id of new Set(a)) df[id]++;
  const idf = df.map((d) => Math.log(verses.length / d));

  // Candidate pairs, as i * 8192 + j with i < j.
  const pairs = new Set<number>();
  const addPair = (i: number | undefined, j: number | undefined) => {
    if (i === undefined || j === undefined || i === j) return;
    pairs.add(i < j ? i * 8192 + j : j * 8192 + i);
  };
  const addAll = (list: number[]) => {
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) addPair(list[x], list[y]);
  };
  for (const e of Object.values(similarDetails ?? {})) {
    for (const m of e.similarAyahs) addPair(at.get(e.sourceAyahKey), at.get(m.ayahKey));
  }
  for (const p of Object.values(phraseDetails ?? {})) {
    const list = [...new Set(p.occurrences.map((o) => at.get(o.ayahKey)))].filter((i) => i !== undefined);
    if (list.length <= MAX_PHRASE_VERSES) addAll(list);
  }
  const V = wordId.size;
  const trigrams = new Map<number, number[]>();
  ids.forEach((a, i) => {
    for (let k = 0; k + 2 < a.length; k++) {
      const g = (a[k] * V + a[k + 1]) * V + a[k + 2];
      const list = trigrams.get(g);
      if (!list) trigrams.set(g, [i]);
      else if (list[list.length - 1] !== i) list.push(i);
    }
  });
  for (const list of trigrams.values()) if (list.length <= MAX_TRIGRAM_VERSES) addAll(list);

  const uniq = ids.map((a) => Int32Array.from(new Set(a)).sort());
  const raw = new Map<number, PairStrength>();
  // How many times each verse is repeated word for word within its surah.
  const identicalInSurah = new Int32Array(verses.length);
  for (const pair of pairs) {
    const i = Math.floor(pair / 8192);
    const j = pair % 8192;
    const s = pairStrength(ids[i], ids[j], uniq[i], uniq[j], loose[i], loose[j], idf);
    if (s.identical && verses[i].surah === verses[j].surah) {
      identicalInSurah[i]++;
      identicalInSurah[j]++;
    }
    if (s.strength > 0 || s.identical) raw.set(pair, s);
  }

  const get = (i: number, j: number) => raw.get(i < j ? i * 8192 + j : j * 8192 + i);
  const sameSurah = (i: number, j: number) => i >= 0 && j < verses.length && verses[i].surah === verses[j].surah;
  const lookAlikes: LookAlike[][] = verses.map(() => []);
  for (const [pair, s] of raw) {
    const i = Math.floor(pair / 8192);
    const j = pair % 8192;
    let strength = s.strength;
    if (s.identical) {
      // Identical verses have nothing to slip on inside them: the slip is in what follows. Inside a run of
      // matching verses it hasn't come yet; at the end of one (Ash-Shu'ara's stories share four verses, then
      // part), the longer the run, the more it carries you on into the other story. A refrain repeated
      // through its surah (فَبِأَيِّ ءَالَآءِ رَبِّكُمَا تُكَذِّبَانِ) is part of the surah's pattern instead.
      const next = sameSurah(i, i + 1) && sameSurah(j, j + 1) && j !== i + 1 ? get(i + 1, j + 1) : undefined;
      if (next?.identical) strength *= 0.25;
      else {
        let run = 0;
        while (run < 3 && i - run - 1 >= 0 && j - run - 1 > i && sameSurah(i - run - 1, i) && sameSurah(j - run - 1, j)) {
          const before = get(i - run - 1, j - run - 1);
          if (!before || !(before.identical || before.strength >= 0.5)) break;
          run++;
        }
        const refrain = verses[i].surah === verses[j].surah && identicalInSurah[i] >= 2;
        strength = Math.max(strength * (refrain ? 0.25 : 0.5), run ? 0.25 + 0.15 * run : 0) * (1 + 0.25 * run);
      }
    }
    strength = Math.min(1, strength);
    if (strength < MIN_STRENGTH) continue;
    lookAlikes[i].push({ other: j, strength });
    lookAlikes[j].push({ other: i, strength });
  }
  const trap = new Float64Array(verses.length);
  lookAlikes.forEach((list, i) => {
    list.sort((a, b) => b.strength - a.strength || a.other - b.other);
    trap[i] = list.length ? list[0].strength + 0.15 * list.slice(1, 4).reduce((sum, l) => sum + l.strength, 0) : 0;
  });

  return { verses, at, lookAlikes, trap, ids };
}

interface PairStrength {
  strength: number;
  identical: boolean;
}

/**
 * How alike two verses are, 0–1: the words they share in order, each weighted by its rarity, plus half the
 * weight of a shared opening (up to six words, a leading و/ف aside) and up to 12 for the share of each verse
 * that matches (short verses one word apart), through a logistic centred on 33.
 */
function pairStrength(
  a: Int32Array,
  b: Int32Array,
  uniqA: Int32Array,
  uniqB: Int32Array,
  looseA: Int32Array,
  looseB: Int32Array,
  idf: Float64Array
): PairStrength {
  let opening = 0;
  for (let k = 0; k < Math.min(6, looseA.length, looseB.length) && looseA[k] === looseB[k]; k++) opening += idf[a[k]];
  // Cheap bound first: the shared words can't weigh more than the words both verses use.
  let bound = 0;
  for (let x = 0, y = 0; x < uniqA.length && y < uniqB.length; ) {
    if (uniqA[x] === uniqB[y]) {
      bound += idf[uniqA[x]];
      x++;
      y++;
    } else if (uniqA[x] < uniqB[y]) x++;
    else y++;
  }
  const maxShare = (2 * Math.min(a.length, b.length)) / (a.length + b.length);
  if (bound + opening / 2 + 12 * maxShare < 20) return { strength: 0, identical: false };

  const aligned = alignWords(a, b);
  let shared = 0;
  for (const [i] of aligned) shared += idf[a[i]];
  const x = shared + opening / 2 + (12 * 2 * aligned.length) / (a.length + b.length);
  const identical = aligned.length === a.length && a.length === b.length;
  return { strength: x < 20 ? 0 : 1 / (1 + Math.exp(-(x - 33) / 7)), identical };
}

// ─── Questions ──────────────────────────────────────────────────

export function inRange(v: PracticeVerse, range: PracticeRange): boolean {
  const value = range.type === "juz" ? v.juz : v.surah;
  return value >= Math.min(range.from, range.to) && value <= Math.max(range.from, range.to);
}

/** The passage after `start`: to the end of the page after the start's page, within the range. */
export function passageEnd(index: PracticeIndex, start: number, range: PracticeRange): number {
  const lastPage = index.verses[start].page + 1;
  let end = start;
  while (
    end + 1 < index.verses.length &&
    index.verses[end + 1].page <= lastPage &&
    inRange(index.verses[end + 1], range)
  ) {
    end++;
  }
  return end;
}

/**
 * How many opening words of verse `i` to show: at least PROMPT_WORDS (or the whole verse), and enough to tell
 * it from every other verse of its surah that opens the same way. Null if no number of its words can: the
 * verse is repeated (or opens another verse) word for word in its surah.
 */
export function promptLength(index: PracticeIndex, i: number): number | null {
  const ids = index.ids[i];
  const surah = index.verses[i].surah;
  let need = 1;
  for (let j = i - 1; j >= 0 && index.verses[j].surah === surah; j--) need = Math.max(need, commonOpening(ids, index.ids[j]) + 1);
  for (let j = i + 1; j < index.verses.length && index.verses[j].surah === surah; j++) {
    need = Math.max(need, commonOpening(ids, index.ids[j]) + 1);
  }
  if (need > ids.length) return null;
  return Math.min(ids.length, Math.max(PROMPT_WORDS, need));
}

function commonOpening(a: Int32Array, b: Int32Array): number {
  let k = 0;
  while (k < a.length && k < b.length && a[k] === b[k]) k++;
  return k;
}

/** Look-alikes of verse `i` worth showing when its passage is checked. */
export const shownLookAlikes = (index: PracticeIndex, i: number, max = 2): LookAlike[] =>
  index.lookAlikes[i].filter((l) => l.strength >= SHOW_STRENGTH).slice(0, max);

/**
 * Picks `count` questions in the range, favouring start verses with look-alikes and passages dense with them
 * (weight: difficulty squared), with chance kept in so sessions differ. Passages never share a page, and a
 * surah already asked about is less likely to come up again. May return fewer if the range is small.
 */
export function generateQuestions(
  index: PracticeIndex,
  range: PracticeRange,
  count: number,
  random: () => number = Math.random
): PracticeQuestion[] {
  interface Candidate {
    start: number;
    end: number;
    weight: number;
  }
  const primary: Candidate[] = [];
  const fallback: Candidate[] = [];
  index.verses.forEach((v, start) => {
    if (!inRange(v, range)) return;
    const end = passageEnd(index, start, range);
    let difficulty = START_WEIGHT * index.trap[start];
    for (let i = start + 1; i <= end; i++) difficulty += index.trap[i];
    if (index.trap[start] >= START_TRAP) primary.push({ start, end, weight: difficulty * difficulty });
    else fallback.push({ start, end, weight: difficulty + 0.1 });
  });

  const chosen: PracticeQuestion[] = [];
  const pagesTaken: [number, number][] = [];
  const surahTaken = new Map<number, number>();
  const pagesOf = (c: Candidate): [number, number] => [index.verses[c.start].page, index.verses[c.end].page];

  for (const pool of [primary, fallback]) {
    const left = [...pool];
    while (chosen.length < count && left.length > 0) {
      const weights = left.map((c) => c.weight * 0.3 ** (surahTaken.get(index.verses[c.start].surah) ?? 0));
      let r = random() * weights.reduce((a, b) => a + b, 0);
      let k = 0;
      while (k < left.length - 1 && r >= weights[k]) r -= weights[k++];
      const c = left.splice(k, 1)[0];
      const [first, last] = pagesOf(c);
      if (pagesTaken.some(([f, l]) => first <= l && last >= f)) continue;
      const promptWords = promptLength(index, c.start);
      if (promptWords === null) continue;
      let traps = 0;
      for (let i = c.start; i <= c.end; i++) if (shownLookAlikes(index, i, 1).length) traps++;
      chosen.push({ start: c.start, end: c.end, key: index.verses[c.start].key, promptWords, traps });
      pagesTaken.push([first, last]);
      const surah = index.verses[c.start].surah;
      surahTaken.set(surah, (surahTaken.get(surah) ?? 0) + 1);
    }
  }

  // Shuffle, so the hardest (most often picked first) don't always come first.
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
  }
  return chosen;
}

// ─── Checking a passage ─────────────────────────────────────────

/**
 * Per word, against a look-alike: "same" for the words the two verses share in order, "diff" for the other
 * words in that shared stretch and the word on either side of it (where the verses part ways); words further
 * out are left unmarked.
 */
export type WordMark = "same" | "diff" | undefined;

export interface Comparison {
  /** marks on verse `a`'s words */
  a: WordMark[];
  /** marks on verse `b`'s words */
  b: WordMark[];
}

export function compareVerses(index: PracticeIndex, a: number, b: number): Comparison {
  const aligned = alignWords(index.ids[a], index.ids[b]);
  return {
    a: marks(index.ids[a].length, aligned.map(([i]) => i)),
    b: marks(index.ids[b].length, aligned.map(([, j]) => j)),
  };
}

function marks(length: number, same: number[]): WordMark[] {
  const out: WordMark[] = new Array(length).fill(undefined);
  if (same.length === 0) return out;
  const first = same[0];
  const last = same[same.length - 1];
  for (let k = Math.max(0, first - 1); k <= Math.min(length - 1, last + 1); k++) out[k] = "diff";
  for (const k of same) out[k] = "same";
  return out;
}
