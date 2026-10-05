/**
 * The memorisation loop prototype (`/lab/memorize`), plain TS: the verse plan, the turn order, and the gate that
 * decides when the reciter (you) has finished a verse from the microphone level alone (no speech model).
 *
 * A prototype for testing how the turn-taking feels, and which microphone setup works in a car over Bluetooth.
 * It is not wired into the rest of the app.
 */

export interface Verse {
  s: number;
  a: number;
}

export const verseKey = (v: Verse) => `${v.s}:${v.a}`;

/** Every verse from `from` to `to`, inclusive, across surahs. Empty if the range is backwards or out of bounds. */
export function versesInRange(ayasPerSurah: number[], from: Verse, to: Verse): Verse[] {
  const ok = (v: Verse) => v.s >= 1 && v.s <= ayasPerSurah.length && v.a >= 1 && v.a <= ayasPerSurah[v.s - 1];
  if (!ok(from) || !ok(to) || to.s < from.s || (to.s === from.s && to.a < from.a)) return [];
  const out: Verse[] = [];
  for (let s = from.s; s <= to.s; s++) {
    const first = s === from.s ? from.a : 1;
    const last = s === to.s ? to.a : ayasPerSurah[s - 1];
    for (let a = first; a <= last; a++) out.push({ s, a });
  }
  return out;
}

export interface Reciter {
  id: string;
  name: string;
  /** everyayah.com folder: https://everyayah.com/data/<folder>/SSSAAA.mp3 */
  folder: string;
}

export const RECITERS: Reciter[] = [
  { id: "husary", name: "Mahmoud Khalil al-Husary", folder: "Husary_128kbps" },
  { id: "husary-muallim", name: "al-Husary (teaching, slower)", folder: "Husary_Muallim_128kbps" },
  { id: "minshawi", name: "Muhammad Siddiq al-Minshawi", folder: "Minshawy_Murattal_128kbps" },
  { id: "abdulbasit", name: "Abdul Basit (murattal)", folder: "Abdul_Basit_Murattal_192kbps" },
  { id: "alafasy", name: "Mishary al-Afasy", folder: "Alafasy_128kbps" },
];

const pad3 = (n: number) => String(n).padStart(3, "0");

/** everyayah.com sends CORS `*`, so the page's COEP allows it with crossorigin="anonymous" / fetch. */
export const verseAudioUrl = (r: Reciter, v: Verse) => `https://everyayah.com/data/${r.folder}/${pad3(v.s)}${pad3(v.a)}.mp3`;

export type Turn = "reciter" | "you";

export interface Step {
  /** index into the plan's verses */
  verse: number;
  /** 1-based repetition */
  rep: number;
  turn: Turn;
}

/** The step after `step`: reciter → you → (next repetition, or the next verse) … null when the plan is done. */
export function nextStep(step: Step, verses: number, reps: number): Step | null {
  if (step.turn === "reciter") return { ...step, turn: "you" };
  if (step.rep < reps) return { verse: step.verse, rep: step.rep + 1, turn: "reciter" };
  if (step.verse + 1 < verses) return { verse: step.verse + 1, rep: 1, turn: "reciter" };
  return null;
}

/** The first step of the next verse (skipping what is left of this one); null after the last verse. */
export function skipVerse(step: Step, verses: number): Step | null {
  return step.verse + 1 < verses ? { verse: step.verse + 1, rep: 1, turn: "reciter" } : null;
}

export interface GateOptions {
  /** frames before this (after the mic is live) are ignored: the cue beep and the room's echo of the reciter */
  guardMs: number;
  /** speech this far above the noise floor (dB) */
  thresholdDb: number;
  /** ...and never quieter than this (dBFS) */
  minSpeechDb: number;
  /** this much quiet after you have recited ends your turn */
  endSilenceMs: number;
  /** you must have spoken at least this long before quiet can end the turn as "silence" */
  minSpeechMs: number;
  /** until you have spoken this long, the quiet needed is longer (long verses: a pause to remember a word) */
  expectSpeechMs: number;
  /** with less speech than minSpeechMs, quiet ends the turn as "no-speech" once the turn is this old */
  noSpeechMs: number;
  /** the turn never lasts longer than this */
  maxMs: number;
  /** the room's level in the previous turn (dBFS), if known: the floor starts no higher than 6 dB above it, so a
   * turn you start speaking straight into still learns the room */
  seedFloorDb?: number;
}

export type GateEnd = "silence" | "no-speech" | "timeout";

export interface GateStatus {
  speaking: boolean;
  /** the last block was above the threshold (speech, or a bump, or the start of speech not yet confirmed) */
  loud: boolean;
  /** total time judged as speech (ms) */
  speechMs: number;
  floorDb: number;
  /** set once the turn is over */
  end: GateEnd | null;
  /** turn time of the first speech (ms), null before */
  firstSpeechAt: number | null;
}

/** 10 ms level frames are averaged into 50 ms blocks. */
const BLOCK_MS = 50;
/** The floor is a low percentile of the last 5 s of blocks... */
const FLOOR_WINDOW_MS = 5000;
const FLOOR_PERCENTILE = 0.1;
/** ...rising no faster than this, so a long stretch of recitation without a pause is not taken for noise. */
const FLOOR_RISE_DB_PER_S = 2;
/** Speech needs this many blocks in a row above the threshold: syllables last longer, road bumps don't. */
const SPEECH_RUN = 3;
/** Long verses: the quiet that ends a turn is this much longer until you have recited for a while. */
const LONG_QUIET_FACTOR = 1.75;
/**
 * Quieter than any real room on a phone or car mic: exact zeros (reported as -120) or near-silence from a mic
 * still starting up (Bluetooth sends this for a moment). Says nothing about the noise floor, so it is skipped.
 */
export const NOT_A_ROOM_DB = -85;

const percentile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

/**
 * Decides when your turn is over from microphone levels, one 10 ms frame (dBFS) at a time. Turn time is counted
 * from frames, not a clock, so it stays right if timers are throttled.
 *
 * The noise floor is the 10th percentile of the last 5 s of 50 ms blocks: it drops within half a second of
 * quiet (so a car's road noise is learned in the first pause), a few odd blocks can't set it, and it rises at
 * most 2 dB/s, so reciting on without a breath for a while still counts as speech. A block is speech when it is
 * the third in a row above floor + threshold (then the whole run counts).
 */
export class TurnGate {
  private t = 0;
  private blockSum = 0;
  private blockN = 0;
  private blocks: { t: number; db: number }[] = [];
  /** every block of the turn (bounded), for roomDb() */
  private history: number[] = [];
  private run = 0;
  private lastSpeechAt = -1;
  readonly status: GateStatus = { speaking: false, loud: false, speechMs: 0, floorDb: -90, end: null, firstSpeechAt: null };

  constructor(readonly opts: GateOptions, readonly frameMs = 10) {}

  get elapsedMs() {
    return this.t;
  }

  /** The room as heard in this turn: the median of the blocks near the final floor (NaN if none). */
  roomDb(): number {
    const near = this.history.filter((db) => db <= this.status.floorDb + 3);
    return near.length ? percentile(near, 0.5) : NaN;
  }

  /** Feeds one frame's level (dBFS); returns the status (end set once the turn is over). */
  push(db: number): GateStatus {
    const st = this.status;
    if (st.end) return st;
    this.t += this.frameMs;
    if (this.t > this.opts.guardMs && db > NOT_A_ROOM_DB) {
      this.blockSum += 10 ** (db / 10);
      this.blockN++;
      if (this.blockN * this.frameMs >= BLOCK_MS) this.block(10 * Math.log10(this.blockSum / this.blockN));
    }
    const o = this.opts;
    const need = st.speechMs < o.expectSpeechMs ? o.endSilenceMs * LONG_QUIET_FACTOR : o.endSilenceMs;
    const quiet = !st.speaking && this.t - this.lastSpeechAt >= need;
    if (this.t >= o.maxMs) st.end = "timeout";
    else if (quiet && st.speechMs >= o.minSpeechMs) st.end = "silence";
    else if (quiet && this.t >= o.noSpeechMs) st.end = "no-speech";
    return st;
  }

  private block(db: number) {
    const st = this.status;
    this.blockSum = 0;
    this.blockN = 0;
    this.blocks.push({ t: this.t, db });
    if (this.history.length < 6000) this.history.push(db);
    while (this.blocks.length && this.blocks[0].t <= this.t - FLOOR_WINDOW_MS) this.blocks.shift();
    const low = percentile(this.blocks.map((b) => b.db), FLOOR_PERCENTILE);
    const seed = this.opts.seedFloorDb;
    const rise = this.blocks.length > 1 ? st.floorDb + (FLOOR_RISE_DB_PER_S * BLOCK_MS) / 1000 : seed !== undefined && Number.isFinite(seed) ? seed + 6 : Infinity;
    st.floorDb = Math.max(-90, Math.min(low, rise));
    const loud = db > Math.max(st.floorDb + this.opts.thresholdDb, this.opts.minSpeechDb);
    st.loud = loud;
    this.run = loud ? this.run + 1 : 0;
    st.speaking = this.run >= SPEECH_RUN;
    if (st.speaking) {
      const credit = this.run === SPEECH_RUN ? SPEECH_RUN : 1;
      st.speechMs += credit * BLOCK_MS;
      st.firstSpeechAt ??= this.t - SPEECH_RUN * BLOCK_MS;
      this.lastSpeechAt = this.t;
    }
  }
}

/** Gate settings for a verse the reciter took `reciterMs` to recite. */
export function gateOptions(reciterMs: number, endSilenceMs: number, thresholdDb: number, guardMs = 400, seedFloorDb = NaN): GateOptions {
  const r = Number.isFinite(reciterMs) && reciterMs > 0 ? reciterMs : 8000;
  return {
    guardMs,
    thresholdDb,
    minSpeechDb: -60,
    endSilenceMs,
    minSpeechMs: Math.min(1000, r * 0.2),
    expectSpeechMs: r > 12000 ? r * 0.4 : 0,
    noSpeechMs: 10000,
    maxMs: Math.max(15000, r * 3 + 5000),
    seedFloorDb,
  };
}
