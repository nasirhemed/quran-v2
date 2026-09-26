import type { RecitationWords } from "./data";
import { partialRatioAlignment } from "./fuzzy";
import { skeleton } from "./skeleton";

/** The whole Quran as one skeleton string, with the owning word of every letter and a letter 5-gram index. */
export class Reference {
  readonly text: string;
  readonly owner: Int32Array;
  readonly wordStart: Int32Array;
  readonly wordText: string[];
  readonly n = 5;
  readonly index = new Map<string, number[]>();

  constructor(words: RecitationWords) {
    const parts: string[] = [];
    this.wordStart = new Int32Array(words.ph.length);
    let pos = 0;
    this.wordText = words.ph.map((ph, idx) => {
      const sk = skeleton(ph) || ph.slice(0, 1);
      this.wordStart[idx] = pos;
      parts.push(sk);
      pos += sk.length;
      return sk;
    });
    this.text = parts.join("");
    this.owner = new Int32Array(this.text.length);
    this.wordText.forEach((sk, idx) => this.owner.fill(idx, this.wordStart[idx], this.wordStart[idx] + sk.length));
    for (let i = 0; i + this.n <= this.text.length; i++) {
      const g = this.text.slice(i, i + this.n);
      const list = this.index.get(g);
      if (list) list.push(i);
      else this.index.set(g, [i]);
    }
  }

  get wordCount() {
    return this.wordStart.length;
  }

  /** Skeleton of words [w0, w1] (clamped) and its start offset in `text`. */
  window(w0: number, w1: number): { start: number; text: string } {
    const a = Math.max(0, w0);
    const b = Math.min(this.wordCount - 1, w1);
    const start = this.wordStart[a];
    return { start, text: this.text.slice(start, this.wordStart[b] + this.wordText[b].length) };
  }

  /** Candidate places for `text` anywhere in the Quran: [(fuzzy score, word idx of the match's end)], best first. */
  search(text: string, limit = 12): { score: number; word: number }[] {
    const votes = new Map<number, number>();
    for (let i = 0; i + this.n <= text.length; i++) {
      const hits = this.index.get(text.slice(i, i + this.n));
      if (!hits) continue;
      for (const p of hits.slice(0, 400)) {
        // very common grams carry little evidence
        const bucket = Math.floor((p - i) / 8);
        votes.set(bucket, (votes.get(bucket) ?? 0) + 1);
      }
    }
    const buckets = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
    return buckets
      .map(([bucket]) => {
        const start = Math.max(0, bucket * 8 - 8);
        const al = partialRatioAlignment(text, this.text.slice(start, start + text.length + 24));
        return { score: al.score, word: this.owner[Math.min(start + al.destEnd - 1, this.text.length - 1)] };
      })
      .sort((a, b) => b.score - a.score);
  }
}
