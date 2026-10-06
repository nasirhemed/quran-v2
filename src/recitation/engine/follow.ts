/**
 * Follow mode (spec v1.3): a forgiving cursor. It finds where the reciter is, then moves word by word; a
 * mistake never stops it and nothing is flagged. Port of the M0b prototype (spike/recitation/engine/follow.py
 * in quran-audio-c), which tracked 98.9% of words on a 30-minute recitation with mistakes.
 *
 * LOCATING: first near the last position (restarts, small jumps), then anywhere in the Quran; commits only when
 * the best place is clearly ahead of any other, so shared openings of similar verses keep it waiting.
 * TRACKING: align the latest heard letters with the text around the cursor; the cursor moves just past the
 * last matched word. After several steps with no match near the cursor, go back to LOCATING.
 */
import { partialRatioAlignment } from "./fuzzy";
import type { Reference } from "./reference";
import { skeleton } from "./skeleton";

export type FollowEvent =
  | { type: "located"; word: number; at: number }
  /** `word` = idx of the next expected word; `from` = first word of the heard stretch that moved it */
  | { type: "cursor"; word: number; at: number; from?: number }
  | { type: "lost"; word: number; at: number };

export const FOLLOW = {
  TAIL: 24, // heard letters kept while tracking
  LOCATE_TAIL: 36, // heard letters used for locating
  TRACK_SCORE: 72, // fuzzy score needed to move the cursor
  LOST_AFTER: 5, // steps with new letters but no match near the cursor before re-locating
  COMMIT_SCORE: 80,
  COMMIT_MARGIN: 8,
  RESTART_MIN: 8, // letters heard since the cursor last moved, before a restart behind it is considered
  RESTART_SCORE: 85, // a restart must match this well: it moves the cursor backwards
};

export class Follower {
  state: "LOCATING" | "TRACKING" = "LOCATING";
  /** idx of the next expected word while tracking */
  cursor: number | null = null;
  private lastGood: number | null = null;
  private heard = "";
  /** letters heard since the cursor last moved (or since locating) */
  private sinceMove = "";
  private misses = 0;
  readonly events: FollowEvent[] = [];
  /** While locating: the best distinct places found by the last search (voice search, spec §8.1). */
  candidates: { word: number; score: number }[] = [];
  /**
   * After startAt(): the tracking window never reaches back before this word (the verse's first). Without it, a
   * verse whose opening also ends the verse before (Ar-Rahman's refrain, 109:5) is matched to the earlier copy.
   * Cleared once the follower is lost or locates on its own.
   */
  private floor: number | null = null;

  constructor(private readonly ref: Reference) {}

  /**
   * Starts tracking at `word` without locating it first, for when the screen knows what comes next (the
   * memorisation loop: the verse you are about to recite). The search is skipped, so a verse that opens like
   * another one is followed from its first word.
   */
  startAt(word: number) {
    this.state = "TRACKING";
    this.cursor = word;
    this.lastGood = word > 0 ? word - 1 : null;
    this.heard = "";
    this.sinceMove = "";
    this.misses = 0;
    this.candidates = [];
    this.floor = word;
  }

  /** The skeleton letters heard most recently (up to 36). */
  get heardTail(): string {
    return this.heard;
  }

  /** Moves the cursor past `word`: the caller has confirmed it was recited (see FollowSession.expect). */
  passTo(word: number) {
    this.cursor = word + 1;
    this.lastGood = word;
    this.misses = 0;
    this.sinceMove = "";
  }

  /** Feed one model step's newly heard phonemes (possibly empty) at time `now` (seconds). */
  push(phonemes: string, now: number): FollowEvent[] {
    const added = skeleton(phonemes);
    if (!added) return [];
    this.heard += added;
    this.sinceMove += added;
    const before = this.events.length;
    if (this.state === "LOCATING") this.locate(now);
    else this.track(now);
    return this.events.slice(before);
  }

  private commit(word: number, now: number) {
    this.state = "TRACKING";
    this.cursor = word + 1;
    this.lastGood = word;
    this.misses = 0;
    this.heard = this.heard.slice(-FOLLOW.TAIL);
    this.sinceMove = "";
    this.candidates = [];
    this.floor = null;
    this.events.push({ type: "located", word, at: now });
  }

  private locate(now: number) {
    const tail = this.heard.slice(-FOLLOW.LOCATE_TAIL);
    if (tail.length < 14) return;
    if (this.lastGood !== null) {
      // spec §7.3: after losing track, look near the last position first
      const w = this.ref.window(this.lastGood - 40, this.lastGood + 60);
      const al = partialRatioAlignment(tail.slice(-20), w.text);
      if (al.score >= FOLLOW.COMMIT_SCORE + 5) {
        this.commit(this.ref.owner[w.start + al.destEnd - 1], now);
        return;
      }
    }
    let scored = this.ref.search(tail);
    if (this.lastGood !== null) {
      const last = this.lastGood;
      scored = scored
        .map((c) => ({ ...c, score: c.score + (c.word - last >= 0 && c.word - last < 40 ? 6 : 0) }))
        .sort((a, b) => b.score - a.score);
    }
    const best = scored[0];
    this.candidates = [];
    for (const c of scored) {
      if (this.candidates.length === 3) break;
      if (this.candidates.every((d) => Math.abs(d.word - c.word) > 3)) this.candidates.push(c);
    }
    if (!best) return;
    // the runner-up must be a different place, not the same passage found twice
    const runner = scored.slice(1).find((c) => Math.abs(c.word - best.word) > 3)?.score ?? 0;
    if (best.score >= FOLLOW.COMMIT_SCORE && best.score - runner >= FOLLOW.COMMIT_MARGIN) this.commit(best.word, now);
  }

  /**
   * First word of a heard stretch starting at letter `pos`. A word the stretch only clips (three letters or fewer,
   * and not all of it) is left out: those letters are usually the tail of the word said just before a restart.
   */
  private stretchStart(pos: number, last: number): number {
    const f = this.ref.owner[pos];
    const covered = this.ref.wordStart[f] + this.ref.wordText[f].length - pos;
    return f < last && covered <= 3 && covered < this.ref.wordText[f].length ? f + 1 : f;
  }

  private track(now: number) {
    const cursor = this.cursor!;
    const tail = this.heard.slice(-FOLLOW.TAIL);
    const w = this.ref.window(this.floor !== null ? Math.max(cursor - 12, this.floor) : cursor - 12, cursor + 14);
    let al = tail.length >= 8 ? partialRatioAlignment(tail.slice(-16), w.text) : null;
    // Restart / repeat (waqf and ibtida', spec §7.3): right after going back, the tail mixes the end of the old
    // position with the start of the repeat and matches nowhere well. The letters heard since the cursor last
    // moved are the repeat alone; if they match clearly behind the cursor, go back there.
    if (this.sinceMove.length >= FOLLOW.RESTART_MIN) {
      const fresh = partialRatioAlignment(this.sinceMove.slice(-16), w.text);
      const freshWord = this.ref.owner[w.start + fresh.destEnd - 1];
      if (fresh.score >= FOLLOW.RESTART_SCORE && freshWord + 1 < cursor && (!al || al.score < FOLLOW.TRACK_SCORE || fresh.score > al.score)) al = fresh;
    }
    if (al && al.score >= FOLLOW.TRACK_SCORE) {
      const word = this.ref.owner[w.start + al.destEnd - 1];
      if (word + 1 !== cursor) {
        this.events.push({ type: "cursor", word: word + 1, at: now, from: this.stretchStart(w.start + Math.max(al.destStart, al.destEnd - this.sinceMove.length), word) });
        this.sinceMove = "";
      }
      this.cursor = word + 1;
      this.lastGood = word;
      this.misses = 0;
    } else if (tail.length >= 8 && ++this.misses >= FOLLOW.LOST_AFTER) {
      // (too few letters to compare is not a miss: right after startAt() nothing has been heard yet)
      this.state = "LOCATING";
      this.floor = null;
      this.events.push({ type: "lost", word: cursor, at: now });
    }
    this.heard = this.heard.slice(-FOLLOW.LOCATE_TAIL);
  }
}

