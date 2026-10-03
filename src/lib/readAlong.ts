/**
 * Read-along in Practice: which words of a question's passage the reciter has said, from the voice session's
 * heard words ("s:a:w", w = 1-based word position, the same segmentation as `PracticeVerse.words`). Plain TS.
 *
 * A verse counts as recited once its last word is heard or the session reports its ayah complete. The opening
 * words the question gave count as already recited. Peeking shows one more word of the verse in progress; it
 * never counts as recited.
 */
import type { PracticeIndex, PracticeQuestion } from "./practice";

export interface ReadAlongProgress {
  /** per verse of the passage (offset from `question.start`): words recited, prompt included */
  heard: number[];
  /** the verse in progress, as an index into `PracticeIndex.verses`; null once the whole passage is recited */
  current: number | null;
}

export interface HeardInput {
  /** words heard, "s:a:w", in any order, repeats allowed */
  keys: Iterable<string>;
  /** ayahs the session reported complete, "s:a" */
  ayahEnds?: Iterable<string>;
}

export function readAlongProgress(index: PracticeIndex, q: PracticeQuestion, input: HeardInput): ReadAlongProgress {
  const n = q.end - q.start + 1;
  const heard = new Array<number>(n).fill(0);
  heard[0] = q.promptWords;
  for (const key of input.keys) {
    const [s, a, w] = key.split(":");
    const i = index.at.get(`${s}:${a}`);
    if (i === undefined || i < q.start || i > q.end) continue;
    heard[i - q.start] = Math.max(heard[i - q.start], Number(w));
  }
  for (const ayah of input.ayahEnds ?? []) {
    const i = index.at.get(ayah);
    if (i !== undefined && i >= q.start && i <= q.end) heard[i - q.start] = index.verses[i].words.length;
  }
  // The reciter goes in order: a verse is only recited once every verse before it is.
  let current: number | null = null;
  for (let k = 0; k < n; k++) {
    const len = index.verses[q.start + k].words.length;
    if (heard[k] >= len) heard[k] = len;
    else {
      current = q.start + k;
      for (let j = k + 1; j < n; j++) heard[j] = 0; // words heard further on don't show: the verse in between isn't done
      break;
    }
  }
  return { heard, current };
}

/** One more word of the verse in progress is shown by each Peek: the new count of peeked words. */
export function peekNext(heard: number, peeked: number, length: number): number {
  return Math.min(length, Math.max(heard, peeked) + 1);
}
