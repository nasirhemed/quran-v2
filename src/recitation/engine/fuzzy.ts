/**
 * Fuzzy string matching used by the tracker and checker: the same definitions as rapidfuzz's `ratio` and
 * `partial_ratio_alignment` (normalized Indel similarity, 0–100), so the Python prototype and this code agree.
 */

/** Longest common subsequence length. */
function lcs(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = ca === b.charCodeAt(j - 1) ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** 100 × (1 − Indel distance / (|a| + |b|)). */
export function ratio(a: string, b: string): number {
  const total = a.length + b.length;
  return total === 0 ? 100 : (200 * lcs(a, b)) / total;
}

export interface Alignment {
  score: number;
  destStart: number;
  destEnd: number; // exclusive, in the longer string
}

/**
 * Best-matching substring of `long` for `short`: every window of |short| letters, plus the shorter windows at
 * both ends (rapidfuzz's partial_ratio). The first best window wins on ties.
 */
export function partialRatioAlignment(short: string, long: string): Alignment {
  if (short.length > long.length) {
    const r = partialRatioAlignment(long, short);
    return { score: r.score, destStart: 0, destEnd: long.length };
  }
  const n = short.length;
  let best: Alignment = { score: 0, destStart: 0, destEnd: 0 };
  const consider = (start: number, end: number) => {
    const score = ratio(short, long.slice(start, end));
    if (score > best.score) best = { score, destStart: start, destEnd: end };
  };
  for (let i = 1; i < n; i++) consider(0, i);
  for (let i = 0; i <= long.length - n; i++) consider(i, i + n);
  for (let i = long.length - n + 1; i < long.length; i++) consider(i, long.length);
  return best;
}

export const partialRatio = (short: string, long: string) => partialRatioAlignment(short, long).score;
