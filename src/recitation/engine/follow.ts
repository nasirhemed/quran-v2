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
  | { type: "cursor"; word: number; at: number } // `word` = idx of the next expected word
  | { type: "lost"; word: number; at: number };

export const FOLLOW = {
  TAIL: 24, // heard letters kept while tracking
  LOCATE_TAIL: 36, // heard letters used for locating
  TRACK_SCORE: 72, // fuzzy score needed to move the cursor
  LOST_AFTER: 5, // steps with new letters but no match near the cursor before re-locating
  COMMIT_SCORE: 80,
  COMMIT_MARGIN: 8,
};

export class Follower {
  state: "LOCATING" | "TRACKING" = "LOCATING";
  /** idx of the next expected word while tracking */
  cursor: number | null = null;
  private lastGood: number | null = null;
  private heard = "";
  private misses = 0;
  readonly events: FollowEvent[] = [];

  constructor(private readonly ref: Reference) {}

  /** Feed one model step's newly heard phonemes (possibly empty) at time `now` (seconds). */
  push(phonemes: string, now: number): FollowEvent[] {
    const added = skeleton(phonemes);
    if (!added) return [];
    this.heard += added;
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
    if (!best) return;
    // the runner-up must be a different place, not the same passage found twice
    const runner = scored.slice(1).find((c) => Math.abs(c.word - best.word) > 3)?.score ?? 0;
    if (best.score >= FOLLOW.COMMIT_SCORE && best.score - runner >= FOLLOW.COMMIT_MARGIN) this.commit(best.word, now);
  }

  private track(now: number) {
    const cursor = this.cursor!;
    const tail = this.heard.slice(-FOLLOW.TAIL);
    const w = this.ref.window(cursor - 12, cursor + 14);
    const al = tail.length >= 8 ? partialRatioAlignment(tail.slice(-16), w.text) : null;
    if (al && al.score >= FOLLOW.TRACK_SCORE) {
      const word = this.ref.owner[w.start + al.destEnd - 1];
      if (word + 1 !== cursor) this.events.push({ type: "cursor", word: word + 1, at: now });
      this.cursor = word + 1;
      this.lastGood = word;
      this.misses = 0;
    } else if (++this.misses >= FOLLOW.LOST_AFTER) {
      this.state = "LOCATING";
      this.events.push({ type: "lost", word: cursor, at: now });
    }
    this.heard = this.heard.slice(-FOLLOW.LOCATE_TAIL);
  }
}

