/**
 * Verify mode (spec v1.3 §7.6): check a whole recording after it stops. Port of the M0b prototype
 * (spike/recitation/engine/verify.py in quran-audio-c).
 *
 * 1. Align the whole recording with the passage on the phoneme skeleton (ignores madd, gemination, harakat,
 *    waqf endings).
 * 2. Missing words → SKIPPED (or WRONG_WORD when other speech sits in their place); a whole missing ayah →
 *    SKIPPED_AYAH. Extra speech → a restart or repeat (never reported), or a MUTASHABIH_SLIP when it matches
 *    another place and not the text around the reciter.
 * 3. Confirm skips and wrong words on the model's log-probs (spec §7.4); drop anything not confirmed. False
 *    alarms are worse than misses (spec §3).
 */
import { opcodes } from "./align";
import { ctcViterbi, gop, type LogProbs } from "./ctc";
import { passageWords, wordUnits, type RecitationWords, type UnitTable } from "./data";
import { partialRatio } from "./fuzzy";
import type { Reference } from "./reference";
import { skeleton } from "./skeleton";

export type MistakeKind = "SKIPPED" | "WRONG_WORD" | "SKIPPED_AYAH" | "MUTASHABIH_SLIP";

export interface Finding {
  kind: MistakeKind;
  /** global word idx: the missing/wrong words, or for a slip the word reached in the other verse */
  words: number[];
  /** seconds into the recording */
  time: number;
  ayah?: string; // SKIPPED_AYAH
  expected?: number; // MUTASHABIH_SLIP: where the reciter should have been
}

export interface Candidate {
  kind: "SKIPPED" | "WRONG_WORD";
  words: number[];
  time: number;
  score: number | null;
  verdict: "confirmed" | "cleared" | "unclear";
}

export const VERIFY = {
  FRAME_S: 0.04,
  MARGIN_FRAMES: 8, // 0.32 s either side of the anchor words
  MAX_WINDOW_FRAMES: 200, // over 8 s between anchors: a restart or pause region, don't judge
  SKIP_LLR: 4, // confirm a skip when log P(without) − log P(with) exceeds this (nats)
  WRONG_GOP: -3, // confirm a wrong word when its GOP is below this
  HEARD: 0.5, // a word with at least half its skeleton letters matched was said
  EXTRA_MIN: 8, // shorter extra-speech runs (skeleton letters) are ignored
  NEAR_WORDS: 60, // how far from the position a repeat can be
  SLIP_SCORE: 88, // an extra-speech window must match another place this well…
  SLIP_LOCAL_MAX: 75, // …and match the text around the reciter less than this
};

export interface HeardUnit {
  unit: number;
  time: number; // seconds
}

export function verify(
  heard: HeardUnit[],
  logprobs: LogProbs,
  words: RecitationWords,
  table: UnitTable,
  ref: Reference,
  from: string,
  to: string,
): { findings: Finding[]; candidates: Candidate[] } {
  const passage = passageWords(words, from, to);

  // 1. skeleton alignment of the whole recording with the passage
  let hyp = "";
  const hypT: number[] = [];
  for (const { unit, time } of heard) {
    for (const c of skeleton(table.symbols[unit])) {
      if (hyp[hyp.length - 1] !== c) {
        hyp += c;
        hypT.push(time);
      }
    }
  }
  let refText = "";
  const owner: number[] = [];
  const lengths = passage.map((w, k) => {
    const sk = skeleton(words.ph[w]) || "?";
    refText += sk;
    for (let c = 0; c < sk.length; c++) owner.push(k);
    return sk.length;
  });
  const matched = new Float64Array(passage.length);
  const replaced = new Float64Array(passage.length);
  const wordTime: ([number, number] | null)[] = passage.map(() => null);
  let extras: [number, number][] = [];
  for (const op of opcodes(hyp, refText)) {
    if (op.tag === "equal") {
      for (let d = 0; d < op.i2 - op.i1; d++) {
        const k = owner[op.j1 + d];
        matched[k]++;
        const t = hypT[op.i1 + d];
        wordTime[k] = wordTime[k] ? [wordTime[k]![0], t] : [t, t];
      }
    } else if (op.tag === "replace") {
      for (let d = op.j1; d < op.j2; d++) replaced[owner[d]]++;
      if (op.i2 - op.i1 - (op.j2 - op.j1) >= 3) extras.push([op.i1 + (op.j2 - op.j1), op.i2]);
    } else if (op.tag === "delete") {
      extras.push([op.i1, op.i2]); // letters only in the recording: extra speech
    }
  }
  // extra speech arrives in fragments: merge pieces separated by a few aligned letters
  const merged: [number, number][] = [];
  for (const [a, b] of extras.sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a - last[1] <= 6) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  extras = merged.filter(([a, b]) => b - a >= VERIFY.EXTRA_MIN);
  const said = passage.map((_, k) => matched[k] / lengths[k] >= VERIFY.HEARD);

  // units of each passage word, per ayah
  const unitsOf = new Map<number, number[]>();
  for (const key of new Set(passage.map((w) => ayahOf(words, w)))) {
    const [first] = words.ayat[key];
    wordUnits(words, table, key).forEach((u, i) => unitsOf.set(first + i, u));
  }

  // 2a/3. missing runs, confirmed on the log-probs
  const findings: Finding[] = [];
  const candidates: Candidate[] = [];
  const frames = logprobs.data.length / logprobs.vocab;
  for (let k = 0; k < passage.length; ) {
    if (said[k]) {
      k++;
      continue;
    }
    let j = k;
    while (j < passage.length && !said[j]) j++;
    const run = passage.slice(k, j);
    const prev = k > 0 ? k - 1 : null;
    const next = j < passage.length ? j : null;
    if (prev !== null && next !== null && wordTime[prev] && wordTime[next]) {
      const f0 = Math.max(0, Math.floor(wordTime[prev]![0] / VERIFY.FRAME_S) - VERIFY.MARGIN_FRAMES);
      const f1 = Math.min(frames, Math.floor(wordTime[next]![1] / VERIFY.FRAME_S) + VERIFY.MARGIN_FRAMES);
      const uPrev = unitsOf.get(passage[prev])!;
      const uNext = unitsOf.get(passage[next])!;
      const uRun = run.flatMap((w) => unitsOf.get(w)!);
      let sumReplaced = 0;
      let sumLength = 0;
      for (let r = k; r < j; r++) {
        sumReplaced += replaced[r];
        sumLength += lengths[r];
      }
      let wrong = sumReplaced / sumLength >= 0.5;
      let verdict: Candidate["verdict"];
      let score: number | null = null;
      if (f1 - f0 > VERIFY.MAX_WINDOW_FRAMES) {
        verdict = "unclear";
      } else {
        // the skip test runs for every candidate: "replaced" letters can be noise around a real skip
        score = ctcViterbi(logprobs, f0, f1, [...uPrev, ...uNext]) - ctcViterbi(logprobs, f0, f1, [...uPrev, ...uRun, ...uNext]);
        verdict = score > VERIFY.SKIP_LLR ? "confirmed" : "cleared";
        if (verdict === "confirmed") wrong = false;
        else if (wrong) {
          score = gop(logprobs, f0, f1, [...uPrev, ...uRun, ...uNext]);
          verdict = score < VERIFY.WRONG_GOP ? "confirmed" : "cleared";
        }
      }
      const kind = wrong ? "WRONG_WORD" : "SKIPPED";
      const time = wordTime[prev]![1];
      candidates.push({ kind, words: run, time, score, verdict });
      if (verdict === "confirmed") findings.push({ kind, words: run, time });
    }
    k = j;
  }

  // whole ayat missing → SKIPPED_AYAH
  const skipped = new Set(findings.filter((f) => f.kind === "SKIPPED").flatMap((f) => f.words));
  for (const key of new Set(passage.map((w) => ayahOf(words, w)))) {
    const [first, n] = words.ayat[key];
    const all = Array.from({ length: n }, (_, i) => first + i);
    if (n > 1 && all.every((w) => skipped.has(w))) {
      const time = findings.find((f) => f.words.includes(first))!.time;
      findings.push({ kind: "SKIPPED_AYAH", words: all, ayah: key, time });
    }
  }

  // 2b. extra speech, checked in overlapping 14-letter windows
  const timeline = passage
    .map((_, k) => (wordTime[k] ? { t: wordTime[k]![0], k } : null))
    .filter((x): x is { t: number; k: number } => x !== null)
    .sort((a, b) => a.t - b.t);
  for (const [i1, i2] of extras) {
    const text = hyp.slice(i1, i2);
    const t = hypT[i1];
    let hereK = 0;
    for (const e of timeline) if (e.t <= t) hereK = e.k;
    const here = passage[hereK];
    const lo = Math.max(0, hereK - VERIFY.NEAR_WORDS);
    const hi = Math.min(passage.length, hereK + VERIFY.NEAR_WORDS);
    let localText = "";
    for (let k = lo; k < hi; k++) localText += skeleton(words.ph[passage[k]]);
    let best: { where: number; score: number; local: number; time: number } | null = null;
    for (let w0 = 0; w0 < Math.max(1, text.length - 13); w0 += 4) {
      const piece = text.slice(w0, w0 + 14);
      const local = partialRatio(piece, localText);
      const top = ref.search(piece, 10)[0];
      if (!top) continue;
      const far = Math.abs(top.word - here) > VERIFY.NEAR_WORDS;
      if (far && top.score >= VERIFY.SLIP_SCORE && local < VERIFY.SLIP_LOCAL_MAX &&
          (!best || top.score - local > best.score - best.local)) {
        best = { where: top.word, score: top.score, local, time: hypT[i1 + w0] };
      }
    }
    if (best) findings.push({ kind: "MUTASHABIH_SLIP", words: [best.where], time: best.time, expected: here });
  }
  findings.sort((a, b) => a.time - b.time);
  return { findings, candidates };
}

function ayahOf(words: RecitationWords, w: number): string {
  // ayat are contiguous and in order: binary search on first-word indices
  const keys = ayahKeys(words);
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (words.ayat[keys[mid]][0] <= w) lo = mid;
    else hi = mid - 1;
  }
  return keys[lo];
}

const keyCache = new WeakMap<RecitationWords, string[]>();
function ayahKeys(words: RecitationWords): string[] {
  let keys = keyCache.get(words);
  if (!keys) {
    keys = Object.keys(words.ayat);
    keyCache.set(words, keys);
  }
  return keys;
}
