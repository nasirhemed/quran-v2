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
  /** you must have spoken at least this long before quiet can end the turn */
  minSpeechMs: number;
  /** no speech at all for this long ends the turn ("no speech") */
  noSpeechMs: number;
  /** the turn never lasts longer than this */
  maxMs: number;
}

export type GateEnd = "silence" | "no-speech" | "timeout";

export interface GateStatus {
  speaking: boolean;
  /** total time judged as speech (ms) */
  speechMs: number;
  floorDb: number;
  /** set once the turn is over */
  end: GateEnd | null;
  /** turn time of the first speech frame (ms), null before */
  firstSpeechAt: number | null;
}

/** 10 ms level frames averaged into 50 ms blocks; the floor is the quietest block of the last 5 s... */
const BLOCK_MS = 50;
const FLOOR_WINDOW_MS = 5000;
/** ...rising no faster than this, so a long stretch of recitation without a pause is not taken for noise */
const FLOOR_RISE_DB_PER_S = 2;
/** the level worklet reports exact zeros as -120 dB */
const DIGITAL_SILENCE_DB = -110;

/**
 * Decides when your turn is over from microphone levels, one 10 ms frame (dBFS) at a time. Turn time is counted
 * from frames, not a clock, so it stays right if timers are throttled.
 *
 * The noise floor is the quietest 50 ms block of the last 5 s: it drops at once in any pause (so a car's road
 * noise is learned within the first gap), and rises slowly (2 dB/s) only when a whole 5 s window is louder, so
 * reciting on without a breath for a while still counts as speech.
 */
export class TurnGate {
  private t = 0;
  private blockSum = 0;
  private blockN = 0;
  private blocks: { t: number; db: number }[] = [];
  private lastSpeechAt = -1;
  readonly status: GateStatus = { speaking: false, speechMs: 0, floorDb: -90, end: null, firstSpeechAt: null };

  constructor(readonly opts: GateOptions, readonly frameMs = 10) {}

  get elapsedMs() {
    return this.t;
  }

  /** Feeds one frame's level (dBFS); returns the status (end set once the turn is over). */
  push(db: number): GateStatus {
    const st = this.status;
    if (st.end) return st;
    this.t += this.frameMs;
    // Digital silence (exact zeros) is a mic still starting up (Bluetooth often sends it for a moment), not a
    // quiet room: it says nothing about the noise floor.
    if (this.t > this.opts.guardMs && db > DIGITAL_SILENCE_DB) {
      this.blockSum += 10 ** (db / 10);
      this.blockN++;
      if (this.blockN * this.frameMs >= BLOCK_MS) this.block(10 * Math.log10(this.blockSum / this.blockN));
    }
    const o = this.opts;
    if (this.t >= o.maxMs) st.end = "timeout";
    else if (st.firstSpeechAt === null && this.t >= o.noSpeechMs) st.end = "no-speech";
    else if (st.speechMs >= o.minSpeechMs && !st.speaking && this.t - this.lastSpeechAt >= o.endSilenceMs) st.end = "silence";
    return st;
  }

  private block(db: number) {
    const st = this.status;
    this.blockSum = 0;
    this.blockN = 0;
    this.blocks.push({ t: this.t, db });
    while (this.blocks.length && this.blocks[0].t <= this.t - FLOOR_WINDOW_MS) this.blocks.shift();
    const quietest = Math.min(...this.blocks.map((b) => b.db));
    const rise = this.blocks.length > 1 ? st.floorDb + (FLOOR_RISE_DB_PER_S * BLOCK_MS) / 1000 : Infinity;
    st.floorDb = Math.max(-90, Math.min(quietest, rise));
    st.speaking = db > Math.max(st.floorDb + this.opts.thresholdDb, this.opts.minSpeechDb);
    if (st.speaking) {
      st.speechMs += BLOCK_MS;
      st.firstSpeechAt ??= this.t - BLOCK_MS;
      this.lastSpeechAt = this.t;
    }
  }
}

/** Gate settings for a verse the reciter took `reciterMs` to recite. */
export function gateOptions(reciterMs: number, endSilenceMs: number, thresholdDb: number): GateOptions {
  const r = Number.isFinite(reciterMs) && reciterMs > 0 ? reciterMs : 8000;
  return {
    guardMs: 400,
    thresholdDb,
    minSpeechDb: -60,
    endSilenceMs,
    minSpeechMs: Math.min(1000, r * 0.2),
    noSpeechMs: Math.max(8000, r * 1.5 + 4000),
    maxMs: Math.max(15000, r * 3 + 5000),
  };
}
