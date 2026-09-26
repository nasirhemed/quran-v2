/**
 * CTC forced alignment on a model's per-frame log-probs (spec §7.4): the best-path log-likelihood of a unit
 * sequence, and a GOP score (goodness of pronunciation) per sequence.
 */
export interface LogProbs {
  data: Float32Array; // row-major (frames, vocab)
  vocab: number;
  blank: number;
}

function extend(labels: number[], blank: number): Int32Array {
  const ext = new Int32Array(labels.length * 2 + 1).fill(blank);
  labels.forEach((u, k) => (ext[2 * k + 1] = u));
  return ext;
}

/** Best-path log-likelihood of `labels` over frames [f0, f1). */
export function ctcViterbi(lp: LogProbs, f0: number, f1: number, labels: number[]): number {
  if (f1 <= f0) return -Infinity;
  const ext = extend(labels, lp.blank);
  const S = ext.length;
  let score = new Float64Array(S).fill(-Infinity);
  let next = new Float64Array(S);
  const row = (t: number) => t * lp.vocab;
  score[0] = lp.data[row(f0) + ext[0]];
  if (S > 1) score[1] = lp.data[row(f0) + ext[1]];
  for (let t = f0 + 1; t < f1; t++) {
    const r = row(t);
    for (let s = 0; s < S; s++) {
      let best = score[s];
      if (s >= 1 && score[s - 1] > best) best = score[s - 1];
      if (s >= 2 && ext[s] !== lp.blank && ext[s] !== ext[s - 2] && score[s - 2] > best) best = score[s - 2];
      next[s] = best + lp.data[r + ext[s]];
    }
    [score, next] = [next, score];
  }
  return S > 1 ? Math.max(score[S - 1], score[S - 2]) : score[S - 1];
}

/**
 * Mean over units of (log P(unit) − max log P(any non-blank unit)), on the frames the best path gives each
 * unit. Near 0: the model heard these units; strongly negative: it heard something else.
 */
export function gop(lp: LogProbs, f0: number, f1: number, labels: number[]): number {
  const T = f1 - f0;
  if (T <= 0) return -Infinity;
  const ext = extend(labels, lp.blank);
  const S = ext.length;
  const score = new Float64Array(T * S).fill(-Infinity);
  const back = new Int32Array(T * S);
  const at = (t: number, u: number) => lp.data[(f0 + t) * lp.vocab + u];
  score[0] = at(0, ext[0]);
  if (S > 1) score[1] = at(0, ext[1]);
  for (let t = 1; t < T; t++) {
    for (let s = 0; s < S; s++) {
      let best = score[(t - 1) * S + s];
      let from = s;
      if (s >= 1 && score[(t - 1) * S + s - 1] > best) {
        best = score[(t - 1) * S + s - 1];
        from = s - 1;
      }
      if (s >= 2 && ext[s] !== lp.blank && ext[s] !== ext[s - 2] && score[(t - 1) * S + s - 2] > best) {
        best = score[(t - 1) * S + s - 2];
        from = s - 2;
      }
      score[t * S + s] = best + at(t, ext[s]);
      back[t * S + s] = from;
    }
  }
  let s = S === 1 || score[(T - 1) * S + S - 1] >= score[(T - 1) * S + S - 2] ? S - 1 : S - 2;
  const perUnit = new Map<number, number[]>();
  for (let t = T - 1; t >= 0; t--) {
    if (ext[s] !== lp.blank) {
      let other = -Infinity;
      for (let v = 0; v < lp.vocab; v++) if (v !== lp.blank && at(t, v) > other) other = at(t, v);
      const list = perUnit.get(s) ?? [];
      list.push(at(t, ext[s]) - other);
      perUnit.set(s, list);
    }
    if (t > 0) s = back[t * S + s];
  }
  const means = [...perUnit.values()].map((v) => v.reduce((a, b) => a + b, 0) / v.length);
  return means.length ? means.reduce((a, b) => a + b, 0) / means.length : -Infinity;
}
