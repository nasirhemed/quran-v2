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
  /** the furthest the cursor has been: words passed again before it are repeats */
  private highWater = -1;
  private completedAyat = new Set<string>();
  private lettersSinceLock = 0;
  private lastCandidates = "";

  constructor(private ref: Reference, words: RecitationWords, private symbols: string[]) {
    this.follower = new Follower(ref);
    for (const [key, [first, n]] of Object.entries(words.ayat)) {
      this.lastAyahWord.set(first + n - 1, key);
      this.ayahStarts.add(first);
    }
  }

  get state() {
    return this.follower.state;
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
          passed.push(e.word - 1); // went back: the word just recited again
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
    return out.filter((e) => e.type !== "heard" || e.words.length > 0);
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
    for (const i of idxs) this.highWater = Math.max(this.highWater, i);
    return { type: "heard", words, step };
  }
}
