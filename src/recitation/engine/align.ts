/**
 * Levenshtein alignment of two strings as opcodes (like rapidfuzz's `Levenshtein.opcodes(a, b)`):
 * "equal" / "replace" / "delete" (letters only in `a`) / "insert" (letters only in `b`).
 *
 * Verify mode aligns a whole recording (≈12,000 skeleton letters for 30 minutes) with the whole passage, so this
 * uses Hirschberg's divide and conquer: O(|a|·|b|) time, but only O(|b|) memory, which a phone can afford.
 */
export type OpTag = "equal" | "replace" | "delete" | "insert";
export interface Opcode {
  tag: OpTag;
  i1: number;
  i2: number;
  j1: number;
  j2: number;
}

type Step = "e" | "r" | "d" | "i";

/** Edit costs of a[a0..a1) against every prefix of b[b0..b1), forwards or backwards. */
function lastRow(a: Uint16Array, a0: number, a1: number, b: Uint16Array, b0: number, b1: number, reverse: boolean): Int32Array {
  const m = b1 - b0;
  let prev = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let ii = 0; ii < a1 - a0; ii++) {
    const ca = reverse ? a[a1 - 1 - ii] : a[a0 + ii];
    cur[0] = ii + 1;
    for (let j = 1; j <= m; j++) {
      const cb = reverse ? b[b1 - j] : b[b0 + j - 1];
      const sub = prev[j - 1] + (ca === cb ? 0 : 1);
      const del = prev[j] + 1;
      const ins = cur[j - 1] + 1;
      cur[j] = sub < del ? (sub < ins ? sub : ins) : del < ins ? del : ins;
    }
    [prev, cur] = [cur, prev];
  }
  return prev;
}

/** Full DP with traceback, for small subproblems. */
function smallAlign(a: Uint16Array, a0: number, a1: number, b: Uint16Array, b0: number, b1: number, out: Step[]) {
  const n = a1 - a0;
  const m = b1 - b0;
  const d = Array.from({ length: n + 1 }, (_, i) => {
    const row = new Int32Array(m + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j - 1] + (a[a0 + i - 1] === b[b0 + j - 1] ? 0 : 1), d[i - 1][j] + 1, d[i][j - 1] + 1);
    }
  }
  const steps: Step[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (a[a0 + i - 1] === b[b0 + j - 1] ? 0 : 1)) {
      steps.push(a[a0 + i - 1] === b[b0 + j - 1] ? "e" : "r");
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      steps.push("d");
      i--;
    } else {
      steps.push("i");
      j--;
    }
  }
  for (let k = steps.length - 1; k >= 0; k--) out.push(steps[k]);
}

function hirschberg(a: Uint16Array, a0: number, a1: number, b: Uint16Array, b0: number, b1: number, out: Step[]) {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n === 0) {
    for (let k = 0; k < m; k++) out.push("i");
    return;
  }
  if (m === 0) {
    for (let k = 0; k < n; k++) out.push("d");
    return;
  }
  if (n <= 2 || m <= 2 || n * m <= 4096) {
    smallAlign(a, a0, a1, b, b0, b1, out);
    return;
  }
  const mid = a0 + (n >> 1);
  const left = lastRow(a, a0, mid, b, b0, b1, false);
  const right = lastRow(a, mid, a1, b, b0, b1, true);
  let split = 0;
  let best = Infinity;
  for (let k = 0; k <= m; k++) {
    const cost = left[k] + right[m - k];
    if (cost < best) {
      best = cost;
      split = k;
    }
  }
  hirschberg(a, a0, mid, b, b0, b0 + split, out);
  hirschberg(a, mid, a1, b, b0 + split, b1, out);
}

const codes = (s: string) => Uint16Array.from(s, (c) => c.charCodeAt(0));

export function opcodes(a: string, b: string): Opcode[] {
  const steps: Step[] = [];
  hirschberg(codes(a), 0, a.length, codes(b), 0, b.length, steps);
  const tagOf: Record<Step, OpTag> = { e: "equal", r: "replace", d: "delete", i: "insert" };
  const ops: Opcode[] = [];
  let i = 0;
  let j = 0;
  for (const s of steps) {
    const tag = tagOf[s];
    const last = ops[ops.length - 1];
    if (!last || last.tag !== tag) ops.push({ tag, i1: i, i2: i, j1: j, j2: j });
    const op = ops[ops.length - 1];
    if (s !== "i") op.i2 = ++i;
    if (s !== "d") op.j2 = ++j;
  }
  return ops;
}
