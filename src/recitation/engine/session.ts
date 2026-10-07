/**
 * Follow mode as a stream of engine events (spec §7.5, §8.2), for the UI: one call per model step.
 *
 * Wraps the Follower (the forgiving cursor) and turns its moves into what the screen needs:
 * - `heard`: Quran words to append to the transcript. With model B the transcript is the text of the words the
 *   cursor passed, not the raw phonemes. Words passed again after the reciter went back are `repeat`.
 * - `cursor`, `located`, `lost`: for the mushaf highlight and page turns.
 * - `ayahComplete`: after the last word of an ayah is passed the first time (verse marker in the transcript).
 * - `candidates`: while still unsure where the reciter is, the best few places (voice search).
 * - `pending`: letters heard but not yet placed (a muted "typing" indicator).
 * Pure TS: runs in the engine worker and in Node tests.
 */
import type { RecitationWords } from "./data";
import { Follower } from "./follow";
import { ratio } from "./fuzzy";
import type { Reference } from "./reference";
import { skeleton } from "./skeleton";

export type HeardStatus = "match" | "repeat";

export type EngineEvent =
  | { type: "located"; word: number; step: number }
  | { type: "cursor"; word: number; step: number } // idx of the next expected word
  | { type: "lost"; word: number; step: number }
  | { type: "heard"; words: { idx: number; status: HeardStatus }[]; step: number }
  | { type: "ayahComplete"; ayah: string; afterWord: number; step: number }
  | { type: "candidates"; places: { word: number; score: number }[]; step: number }
  | { type: "pending"; letters: number; step: number };

/** The most words one cursor move may add to the transcript; a bigger forward jump is a skip, not speech. */
const MAX_WORDS_PER_MOVE = 8;
/**
 * On locating, the transcript is filled in back over the letters heard while the place was still unclear (a
 * shared opening like 2:255 / 3:2 can take ten words to tell apart), up to this many letters and words.
 */
const LOCATE_LETTERS = 90;
const LOCATE_WORDS = 16;

export class FollowSession {
  readonly follower: Follower;
  private lastAyahWord = new Map<number, string>();
  private ayahStarts = new Set<number>();
  private ayahKeys: string[] = [];
  private ayahOfWord: Int32Array;
  /** ayah (index into ayahKeys) → words of it passed the first time; the recited passage for verify mode */
  private visits = new Map<number, number>();
  /** the furthest the cursor has been: words passed again before it are repeats */
  private highWater = -1;
  private completedAyat = new Set<string>();
  private lettersSinceLock = 0;
  private lastCandidates = "";
  /** set by expect(): the verse being recited, and the skeleton of its ending (see checkEnding) */
  private expected: { ayah: string; first: number; last: number; ending: string; short: boolean; twins: Set<number> } | null = null;
  /** first word idx of each word's ayah */
  private ayahFirst: Int32Array;

  constructor(private ref: Reference, private words: RecitationWords, private symbols: string[]) {
    this.follower = new Follower(ref);
    this.ayahOfWord = new Int32Array(words.ph.length);
    this.ayahFirst = new Int32Array(words.ph.length);
    for (const [key, [first, n]] of Object.entries(words.ayat)) {
      this.lastAyahWord.set(first + n - 1, key);
      this.ayahStarts.add(first);
      this.ayahOfWord.fill(this.ayahKeys.length, first, first + n);
      this.ayahFirst.fill(first, first, first + n);
      this.ayahKeys.push(key);
    }
  }

  get state() {
    return this.follower.state;
  }

  /**
   * The reciter is about to recite from `word` (the first word of a verse): follow from there, no voice search.
   * `ayahComplete` then comes for that verse once its last word is passed.
   */
  expect(word: number) {
    this.follower.startAt(word);
    // nothing counts as recited yet: a slip back into the verse before also completes it (and is reported)
    this.highWater = -1;
    this.lettersSinceLock = 0;
    this.completedAyat.clear();
    this.lastCandidates = "";
    let last = word;
    while (!this.lastAyahWord.has(last) && last < this.words.ph.length - 1) last++;
    const whole = skeleton(this.words.ph.slice(word, last + 1).join(""));
    const short = whole.length < 8;
    // the last two words' skeleton, joined first so a letter shared across the boundary is collapsed as in what is
    // heard (غفور رحيم → غفرحم); a verse too short to track is matched whole
    const ending = short ? whole : skeleton(this.words.ph.slice(Math.max(word, last - 1), last + 1).join(""));
    // verses with the same words (Ar-Rahman's refrain, 31 times): after losing its place the tracker may pick up
    // another copy, which is the same recitation; their words and completion count as the expected verse's
    const twins = new Set<number>();
    const n = last - word + 1;
    for (const [first, count] of Object.values(this.words.ayat)) {
      if (count !== n || first === word) continue;
      let same = true;
      for (let i = 0; i < n && same; i++) same = this.words.ph[first + i] === this.words.ph[word + i];
      if (same) twins.add(first);
    }
    this.expected = { ayah: this.lastAyahWord.get(last)!, first: word, last, ending, short, twins };
  }

  /** expect() mode: a word of a twin verse (same words as the expected one) as the expected verse's word. */
  private asExpected(idx: number): number {
    const x = this.expected;
    if (!x || !x.twins.size) return idx;
    const first = this.ayahFirst[idx];
    return x.twins.has(first) ? x.first + (idx - first) : idx;
  }

  /**
   * expect() mode: the tracker can stop ON the verse's last word, one letter short of passing it (a letter shared
   * with the word before), and a verse under 8 letters is never tracked at all. In Follow mode the next verse's
   * letters settle both; here nothing follows, the reciter stops. So compare the latest heard letters with the
   * verse's ending directly, and complete the verse when they match.
   */
  private checkEnding(step: number): EngineEvent[] {
    const x = this.expected;
    if (!x || this.completedAyat.has(x.ayah) || this.follower.state !== "TRACKING") return [];
    const c = this.follower.cursor!;
    if (x.short ? c < x.first || c > x.last : c !== x.last) return [];
    const tail = this.follower.heardTail;
    if (tail.length < x.ending.length * 0.8 || ratio(tail.slice(-x.ending.length), x.ending) < 85) return [];
    const passed: number[] = [];
    for (let w = x.short ? c : x.last; w <= x.last; w++) passed.push(w);
    this.completedAyat.add(x.ayah);
    this.follower.passTo(x.last);
    return [this.heard(passed, step), { type: "ayahComplete", ayah: x.ayah, afterWord: x.last, step }, { type: "cursor", word: x.last + 1, step }];
  }

  /** One model step's new units (ids). `time` is the step's time in seconds (for the follower's events). */
  push(units: number[], step: number, time: number): EngineEvent[] {
    const phonemes = units.map((u) => this.symbols[u] ?? "").join("");
    const letters = skeleton(phonemes).length;
    const before = this.follower.cursor;
    const wasTracking = this.follower.state === "TRACKING";
    const fe = this.follower.push(phonemes, time);
    const out: EngineEvent[] = [];

    for (const e of fe) {
      if (e.type === "located") {
        // somewhere else entirely (a new passage): nothing there has been recited yet
        if (Math.abs(e.word - this.highWater) > 60) this.highWater = -1;
        out.push({ type: "located", word: e.word, step });
        out.push(this.heard(this.lockWords(e.word, this.lettersSinceLock + letters), step));
        out.push({ type: "cursor", word: e.word + 1, step });
        this.lettersSinceLock = 0;
      } else if (e.type === "lost") {
        out.push({ type: "lost", word: e.word, step });
      } else if (e.type === "cursor") {
        const from = wasTracking && before !== null ? before : e.word - 1;
        const passed: number[] = [];
        if (e.word > from) {
          const start = Math.max(from, e.word - MAX_WORDS_PER_MOVE);
          for (let w = start; w < e.word; w++) passed.push(w);
        } else {
          // went back (a repeat): the words recited again, from where the repeat was matched, not past an ayah start
          let start = Math.max(e.from ?? e.word - 1, e.word - MAX_WORDS_PER_MOVE);
          for (let w = e.word - 1; w > start; w--) if (this.ayahStarts.has(w)) start = w;
          for (let w = start; w < e.word; w++) passed.push(w);
        }
        out.push(this.heard(passed, step));
        out.push({ type: "cursor", word: e.word, step });
      }
    }
    for (const e of out.slice()) {
      if (e.type !== "heard") continue;
      for (const { idx, status } of e.words) {
        const ayah = this.lastAyahWord.get(idx);
        if (ayah && status === "match" && !this.completedAyat.has(ayah)) {
          this.completedAyat.add(ayah);
          out.splice(out.indexOf(e) + 1, 0, { type: "ayahComplete", ayah, afterWord: idx, step });
        }
      }
    }

    if (this.follower.state === "LOCATING") {
      this.lettersSinceLock += letters;
      if (letters) out.push({ type: "pending", letters: this.lettersSinceLock, step });
      const key = JSON.stringify(this.follower.candidates.map((c) => c.word));
      if (key !== this.lastCandidates) {
        this.lastCandidates = key;
        out.push({ type: "candidates", places: this.follower.candidates, step });
      }
    } else if (this.lastCandidates !== "[]") {
      this.lastCandidates = "[]";
      out.push({ type: "candidates", places: [], step });
    }
    out.push(...this.checkEnding(step));
    const x = this.expected;
    let events = out;
    if (x?.twins.size) {
      events = [];
      for (const e of out) {
        if (e.type === "heard") events.push({ ...e, words: e.words.map((w) => ({ ...w, idx: this.asExpected(w.idx) })) });
        else if (e.type === "ayahComplete" && x.twins.has(this.ayahFirst[e.afterWord])) {
          // a twin was recited to its end: the expected verse was (reported once)
          if (!this.completedAyat.has(x.ayah)) {
            this.completedAyat.add(x.ayah);
            events.push({ ...e, ayah: x.ayah, afterWord: x.last });
          }
        } else events.push(e);
      }
    }
    return events.filter((e) => e.type !== "heard" || e.words.length > 0);
  }

  /**
   * The words that got the tracker to lock on `word`: back from it, over the letters heard while locating.
   * The model hears a little less than the written skeleton (merged letters, elisions), hence the slack.
   */
  private lockWords(word: number, heardLetters: number): number[] {
    const want = Math.min(LOCATE_LETTERS, Math.max(heardLetters, 8) * 1.15 + 4);
    const words: number[] = [];
    let letters = 0;
    for (let w = word; w >= 0 && words.length < LOCATE_WORDS; w--) {
      words.unshift(w);
      letters += this.ref.wordText[w].length;
      // never back across the start of an ayah: that is where recitation begins
      if (letters >= want || this.ayahStarts.has(w)) break;
    }
    return words;
  }

  private heard(idxs: number[], step: number): EngineEvent {
    const words = idxs.map((idx) => {
      const status: HeardStatus = idx <= this.highWater ? "repeat" : "match";
      return { idx, status };
    });
    for (const { idx, status } of words) {
      if (status !== "match") continue;
      const a = this.ayahOfWord[idx];
      this.visits.set(a, (this.visits.get(a) ?? 0) + 1);
    }
    for (const i of idxs) this.highWater = Math.max(this.highWater, i);
    return { type: "heard", words, step };
  }

  /**
   * The passage the reciter recited, for verify mode: the longest run of nearby ayat (gaps of up to 3) in which
   * at least 2 words were followed. Brief visits elsewhere (a slip into a similar verse) don't count. Same rule
   * as the M0b prototype (run_recording.py detect_range).
   */
  passage(): { from: string; to: string } | null {
    const main = [...this.visits].filter(([, n]) => n >= 2).map(([a]) => a).sort((x, y) => x - y);
    if (!main.length) return null;
    let best: number[] = [];
    let cur = [main[0]];
    for (const a of main.slice(1)) {
      if (a - cur[cur.length - 1] <= 3) cur.push(a);
      else {
        if (cur.length > best.length) best = cur;
        cur = [a];
      }
    }
    if (cur.length > best.length) best = cur;
    return { from: this.ayahKeys[best[0]], to: this.ayahKeys[best[best.length - 1]] };
  }
}
