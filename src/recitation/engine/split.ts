/**
 * Split a long recitation (a whole surah in one file) into ayahs: align what model B heard with the known text,
 * as Verify mode does, then put each cut in the quiet between one ayah's last word and the next ayah's first.
 *
 * Silence alone can't do this: reciters pause at waqf marks inside an ayah and sometimes join two ayat. The
 * alignment says which pause is the boundary; the audio level says where in that pause to cut.
 *
 * Plain TS, no DOM: scripts/split-ayahs.ts runs it in Node, and the app could run it on the device.
 */
import { opcodes } from "./align";
import type { RecitationWords, UnitTable } from "./data";
import { skeleton } from "./skeleton";
import type { HeardUnit } from "./verify";

/** The audio level, in dBFS, of consecutive frames `frameS` seconds long. */
export interface Level {
  db: Float32Array;
  frameS: number;
}

export interface AyahSpan {
  /** "s:a", or "basmala" for the basmala recited before the surah's first ayah */
  ayah: string;
  /** seconds: where this ayah's clip starts and ends (the pauses between ayat are left out) */
  start: number;
  end: number;
  /** share of the ayah's words the model heard; low means the times are estimated */
  heard: number;
  /** how the cut before this ayah was placed: "pause" (in a quiet stretch), "quietest" (no pause: joined
   * ayat, cut at the quietest point) or "estimated" (the words around it weren't heard) */
  cut: "pause" | "quietest" | "estimated" | "first";
}

export const SPLIT = {
  /** a word counts as heard when this share of its skeleton letters aligned */
  HEARD: 0.5,
  /** only matches in runs of at least this many letters give times (single letters line up by chance) */
  MIN_RUN: 3,
  /** a pause is quieter than the file's speech level minus this (dB) */
  PAUSE_BELOW_SPEECH_DB: 25,
  /** ...and at least this long (s) */
  MIN_PAUSE_S: 0.15,
  /** model B emits a unit a little after its sound starts: look this far back from the next ayah's first unit */
  ONSET_LAG_S: 0.35,
  /** speech kept either side of a cut (s) */
  PAD_BEFORE_S: 0.15,
  PAD_AFTER_S: 0.3,
};

/** Every ayah key from `from` to `to` (inclusive, mushaf order). */
export function ayahRange(words: RecitationWords, from: string, to: string): string[] {
  const keys = Object.keys(words.ayat);
  const i = keys.indexOf(from);
  const j = keys.indexOf(to);
  if (i < 0 || j < i) throw new Error(`Bad range ${from}–${to}`);
  return keys.slice(i, j + 1);
}

/**
 * `ayat`: the ayah keys recited, in order (usually a whole surah: ayahRange(words, "5:1", "5:120")).
 * `basmala`: the recording starts with the basmala (every surah but 1 and 9); it gets its own span.
 * Anything before (the isti'adha) is left out of every span.
 */
export function splitAyahs(
  heard: HeardUnit[],
  words: RecitationWords,
  table: UnitTable,
  ayat: string[],
  level: Level,
  opts: { basmala?: boolean; duration?: number } = {},
): AyahSpan[] {
  const duration = opts.duration ?? level.db.length * level.frameS;
  // reference: [basmala] + the ayat, word by word
  const segs: { ayah: string; words: number[] }[] = [];
  const range = (key: string) => {
    const [first, n] = words.ayat[key];
    return Array.from({ length: n }, (_, i) => first + i);
  };
  if (opts.basmala) segs.push({ ayah: "basmala", words: range("1:1") });
  for (const key of ayat) segs.push({ ayah: key, words: range(key) });

  let refText = "";
  const owner: number[] = []; // ref letter → [seg, word] flattened word index
  const wordSeg: number[] = [];
  const lengths: number[] = [];
  segs.forEach((s, si) =>
    s.words.forEach((w) => {
      const sk = skeleton(words.ph[w]) || "?";
      refText += sk;
      for (let c = 0; c < sk.length; c++) owner.push(lengths.length);
      lengths.push(sk.length);
      wordSeg.push(si);
    }),
  );

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

  const matched = new Float64Array(lengths.length);
  const first = new Float64Array(lengths.length).fill(Infinity);
  const last = new Float64Array(lengths.length).fill(-Infinity);
  for (const op of opcodes(hyp, refText)) {
    if (op.tag !== "equal") continue;
    const run = op.i2 - op.i1;
    for (let d = 0; d < run; d++) {
      const k = owner[op.j1 + d];
      matched[k]++;
      if (run < SPLIT.MIN_RUN) continue;
      const t = hypT[op.i1 + d];
      if (t < first[k]) first[k] = t;
      if (t > last[k]) last[k] = t;
    }
  }

  // each segment: times of its first and last heard word
  const segInfo = segs.map(() => ({ t0: Infinity, t1: -Infinity, said: 0, n: 0 }));
  for (let k = 0; k < lengths.length; k++) {
    const s = segInfo[wordSeg[k]];
    s.n++;
    if (matched[k] / lengths[k] < SPLIT.HEARD || first[k] === Infinity) continue;
    s.said++;
    s.t0 = Math.min(s.t0, first[k]);
    s.t1 = Math.max(s.t1, last[k]);
  }
  // keep times in order (a repeat can pull a word's time back), then fill unheard segments by letter count
  let floor = 0;
  for (const s of segInfo) {
    if (s.said === 0) continue;
    if (s.t0 < floor) s.t0 = floor;
    if (s.t1 < s.t0) s.t1 = s.t0;
    floor = s.t1;
  }
  const letters = segs.map((s) => s.words.reduce((n, w) => n + (skeleton(words.ph[w]).length || 1), 0));
  for (let i = 0; i < segInfo.length; i++) {
    if (segInfo[i].said) continue;
    let j = i;
    while (j < segInfo.length && !segInfo[j].said) j++;
    const a = i > 0 ? segInfo[i - 1].t1 : 0;
    const b = j < segInfo.length ? segInfo[j].t0 : duration;
    const total = letters.slice(i, j).reduce((x, y) => x + y, 0);
    let t = a;
    for (let m = i; m < j; m++) {
      segInfo[m].t0 = t;
      t += ((b - a) * letters[m]) / total;
      segInfo[m].t1 = t;
    }
    i = j - 1;
  }

  // a recording that starts straight with the first ayah: drop the basmala and align again
  if (opts.basmala && segInfo[0].said / segInfo[0].n < SPLIT.HEARD) {
    return splitAyahs(heard, words, table, ayat, level, { ...opts, basmala: false });
  }

  const speech = percentile(level.db, 0.9);
  const quiet = speech - SPLIT.PAUSE_BELOW_SPEECH_DB;
  const frameAt = (t: number) => Math.max(0, Math.min(level.db.length - 1, Math.round(t / level.frameS)));

  const spans: AyahSpan[] = segs.map((s, i) => ({
    ayah: s.ayah,
    start: 0,
    end: duration,
    heard: segInfo[i].n ? segInfo[i].said / segInfo[i].n : 0,
    cut: "first" as AyahSpan["cut"],
  }));
  // before the first segment: the last pause before its first unit (skips the isti'adha)
  spans[0].start = Math.max(0, onsetBefore(level, quiet, Math.max(0, segInfo[0].t0 - SPLIT.ONSET_LAG_S - 6), segInfo[0].t0) - SPLIT.PAD_BEFORE_S);
  for (let i = 0; i + 1 < segs.length; i++) {
    const a = segInfo[i];
    const b = segInfo[i + 1];
    const estimated = !a.said || !b.said;
    const lo = frameAt(a.t1);
    const hi = Math.max(lo + 1, frameAt(b.t0 - SPLIT.ONSET_LAG_S));
    // the longest quiet run between the two
    let best: [number, number] | null = null;
    for (let f = lo; f < hi; ) {
      if (level.db[f] >= quiet) {
        f++;
        continue;
      }
      let g = f;
      while (g < hi && level.db[g] < quiet) g++;
      if (!best || g - f > best[1] - best[0]) best = [f, g];
      f = g;
    }
    let endA: number;
    let startB: number;
    let how: AyahSpan["cut"];
    if (best && (best[1] - best[0]) * level.frameS >= SPLIT.MIN_PAUSE_S) {
      // a pause can run past `hi`: follow it to where the next ayah's sound starts
      let g = best[1];
      while (g < level.db.length && level.db[g] < quiet) g++;
      endA = Math.min(best[0] * level.frameS + SPLIT.PAD_AFTER_S, (best[0] + g) / 2 * level.frameS);
      startB = Math.max(g * level.frameS - SPLIT.PAD_BEFORE_S, endA);
      how = "pause";
    } else {
      let m = lo;
      for (let f = lo; f < hi; f++) if (level.db[f] < level.db[m]) m = f;
      endA = startB = m * level.frameS;
      how = "quietest";
    }
    spans[i].end = endA;
    spans[i + 1].start = startB;
    spans[i + 1].cut = estimated ? "estimated" : how;
  }
  // after the last segment: the first long pause after its last unit, else the end of the file
  const lastSeg = segInfo[segs.length - 1];
  const tail = frameAt(lastSeg.t1);
  let f = tail;
  while (f < level.db.length) {
    let g = f;
    while (g < level.db.length && level.db[g] < quiet) g++;
    if ((g - f) * level.frameS >= 1.5) break;
    f = g + 1;
  }
  spans[spans.length - 1].end = Math.min(duration, f * level.frameS + SPLIT.PAD_AFTER_S);
  return spans;
}

/** Where speech starts before `t`: the end of the last pause in [from, t], or `from`. */
function onsetBefore(level: Level, quiet: number, from: number, t: number): number {
  const f0 = Math.round(from / level.frameS);
  let f = Math.min(level.db.length - 1, Math.round(t / level.frameS));
  // walk back through speech to the nearest quiet stretch
  while (f > f0) {
    let g = f;
    while (g > f0 && level.db[g - 1] < quiet) g--;
    if ((f - g) * level.frameS >= SPLIT.MIN_PAUSE_S) return f * level.frameS;
    f = g - 1;
  }
  return from;
}

function percentile(x: Float32Array, p: number): number {
  const s = Float32Array.from(x).sort();
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

/** dBFS of `samples` in frames of `frameS` seconds. */
export function levelOf(samples: Float32Array, rate: number, frameS = 0.01): Level {
  const n = Math.round(rate * frameS);
  const db = new Float32Array(Math.ceil(samples.length / n));
  for (let i = 0; i < db.length; i++) {
    let e = 0;
    const end = Math.min(samples.length, (i + 1) * n);
    for (let j = i * n; j < end; j++) e += samples[j] * samples[j];
    db[i] = 10 * Math.log10(e / Math.max(1, end - i * n) + 1e-12);
  }
  return { db, frameS };
}
