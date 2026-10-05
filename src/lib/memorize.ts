/**
 * Memorize (`/memorize`), plain TS: the verse plan and turn order (listen ×X, then you and the reciter in turn,
 * N times per verse), the rules for your turn with the speech model (ModelTurn: when it ends, when to hint), and
 * the gate that hears whether you are speaking (TurnGate; without the model, it alone decides when your turn ends).
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
  { id: "ali-jaber", name: "Ali Jaber", folder: "Ali_Jaber_64kbps" },
  { id: "husary", name: "Mahmoud Khalil al-Husary", folder: "Husary_128kbps" },
  { id: "husary-muallim", name: "al-Husary (teaching, slower)", folder: "Husary_Muallim_128kbps" },
  { id: "minshawi", name: "Muhammad Siddiq al-Minshawi", folder: "Minshawy_Murattal_128kbps" },
  { id: "abdulbasit", name: "Abdul Basit (murattal)", folder: "Abdul_Basit_Murattal_192kbps" },
  { id: "alafasy", name: "Mishary al-Afasy", folder: "Alafasy_128kbps" },
];

export const DEFAULT_RECITER = RECITERS[0];

const pad3 = (n: number) => String(n).padStart(3, "0");

/** everyayah.com sends CORS `*`, so the page's COEP allows it with crossorigin="anonymous" / fetch. */
export const verseAudioUrl = (r: Reciter, v: Verse) => `https://everyayah.com/data/${r.folder}/${pad3(v.s)}${pad3(v.a)}.mp3`;

/** "listen": the reciter alone, before your first turn; "reciter": the reciter before one of your turns. */
export type Turn = "listen" | "reciter" | "you";

export interface Step {
  /** index into the plan's verses */
  verse: number;
  /** 1-based: the listen number (turn "listen"), or the repetition (turn "reciter" / "you") */
  rep: number;
  turn: Turn;
}

export interface Plan {
  verses: number;
  /** times you recite each verse */
  reps: number;
  /** times you listen to it first */
  listen: number;
}

/** A verse starts with its listens; with none, with the reciter before your first turn. */
export const verseStart = (verse: number, plan: Plan): Step => ({ verse, rep: 1, turn: plan.listen > 0 ? "listen" : "reciter" });

/**
 * The step after `step`, null when the plan is done. Each verse: listen ×X, then your turn (you have just heard
 * it), then reciter → you for the remaining repetitions. With no listens: reciter → you, N times.
 */
export function nextStep(step: Step, plan: Plan): Step | null {
  if (step.turn === "listen") return step.rep < plan.listen ? { ...step, rep: step.rep + 1 } : { verse: step.verse, rep: 1, turn: "you" };
  if (step.turn === "reciter") return { ...step, turn: "you" };
  if (step.rep < plan.reps) return { verse: step.verse, rep: step.rep + 1, turn: "reciter" };
  return skipVerse(step, plan);
}

/** The start of the next verse (skipping what is left of this one); null after the last verse. */
export function skipVerse(step: Step, plan: Plan): Step | null {
  return step.verse + 1 < plan.verses ? verseStart(step.verse + 1, plan) : null;
}

/** "Again": hear this verse once more, then your turn (the same repetition). */
export const again = (step: Step): Step => (step.turn === "listen" ? { ...step } : { verse: step.verse, rep: step.rep, turn: "reciter" });

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
  /** until you have spoken this long, the quiet needed is longer (a breath, or a pause to remember a word) */
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
  /** how long it has been quiet since the last speech (0 while speaking, or before any speech) */
  quietMs: number;
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
/** The quiet that ends a turn is this much longer until you have recited for a while (a breath mid-verse). */
const LONG_QUIET_FACTOR = 1.75;
/**
 * Quieter than any real room on a phone or car mic: exact zeros (reported as -120) or near-silence from a mic
 * still starting up (Bluetooth sends this for a moment). Says nothing about the noise floor, so it is skipped.
 */
export const NOT_A_ROOM_DB = -85;
/**
 * The room's level to assume when no turn has measured it yet (the first turn): the floor then starts no higher
 * than 6 dB above this, so a turn you start reciting into at once still hears you. Quieter than any voice on a
 * phone or car mic (≈ -35..-15 dBFS), louder than most rooms; a louder car is learned within a few seconds.
 */
export const ROOM_PRIOR_DB = -48;

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
  readonly status: GateStatus = { speaking: false, loud: false, speechMs: 0, quietMs: 0, floorDb: -90, end: null, firstSpeechAt: null };

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
    st.quietMs = st.speaking || this.lastSpeechAt < 0 ? 0 : this.t - this.lastSpeechAt;
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
    expectSpeechMs: r > 4000 ? r * 0.4 : 0,
    noSpeechMs: 10000,
    maxMs: Math.max(15000, r * 3 + 5000),
    // never above the prior: one turn's bad estimate (reciting without a pause) must not hide your voice next turn
    seedFloorDb: Math.min(Number.isFinite(seedFloorDb) ? seedFloorDb : ROOM_PRIOR_DB, ROOM_PRIOR_DB),
  };
}

export interface ModelTurnOptions {
  /** words in the verse */
  words: number;
  /** without progress (a new word heard, or a hint) for this long, the next words are shown; 0 = no hints */
  hintAfterMs: number;
  /** ...and before you have started (the car may still be playing the reciter's end) */
  startHintAfterMs: number;
  /** once you have started, this much quiet moves on (you stopped); Infinity = never */
  giveUpMs: number;
  /** not started after this long: moves on (the reciter plays it again) */
  notStartedMs: number;
  maxMs: number;
}

export type ModelTurnEnd = "complete" | "stopped" | "not-started" | "timeout";

/** After the last word: this much quiet ends the turn (so a final madd isn't cut), or this long if you carry on. */
const COMPLETE_QUIET_MS = 500;
const COMPLETE_MAX_MS = 2500;
/** A hint waits for you to be quiet this long (never mid-word)... */
const HINT_QUIET_MS = 1200;
/** ...and shows this many more words. */
const HINT_WORDS = 2;

/**
 * Your turn with the speech model, by turn time (ms): the model says which of the verse's words you have reached
 * (heard) and when you have recited it to the end (complete); tick() says whether the mic hears a voice.
 *
 * Quiet only counts once you have started the verse: before that, the reciter's end may still be playing in a car
 * (Bluetooth adds seconds of delay), and you may need a moment. Once started, a pause to remember is fine: after
 * hintAfterMs without progress the next words are shown, and only a long quiet (giveUpMs) moves on.
 */
export class ModelTurn {
  /** the furthest word heard, 1-based (0: not started) */
  heardTo = 0;
  /** the furthest word shown as a hint */
  hintTo = 0;
  hints = 0;
  end: ModelTurnEnd | null = null;
  private lastProgressAt = 0;
  private lastVoiceAt: number | null = null;
  private completeAt: number | null = null;

  constructor(readonly o: ModelTurnOptions) {}

  get started() {
    return this.heardTo > 0;
  }

  /** The model heard word `position` (1-based) of the verse. */
  heard(position: number, t: number) {
    if (position <= this.heardTo) return;
    this.heardTo = Math.min(position, this.o.words);
    this.lastProgressAt = t;
  }

  /** The model heard the verse to its last word. */
  complete(t: number) {
    this.completeAt ??= t;
    this.heardTo = this.o.words;
  }

  /** At turn time t, with or without a voice at the mic. Returns the new hint (show words up to this one), or null. */
  tick(t: number, voice: boolean): number | null {
    if (this.end) return null;
    if (voice) this.lastVoiceAt = t;
    const quiet = t - (this.lastVoiceAt ?? 0);
    const o = this.o;
    if (this.completeAt !== null) {
      if (quiet >= COMPLETE_QUIET_MS || t - this.completeAt >= COMPLETE_MAX_MS) this.end = "complete";
      return null;
    }
    if (t >= o.maxMs) this.end = "timeout";
    else if (!this.started && t >= o.notStartedMs) this.end = "not-started";
    else if (this.started && quiet >= o.giveUpMs) this.end = "stopped";
    if (this.end) return null;
    const shown = Math.max(this.heardTo, this.hintTo);
    const wait = this.started ? o.hintAfterMs : o.startHintAfterMs;
    if (o.hintAfterMs > 0 && shown < o.words && t - this.lastProgressAt >= wait && quiet >= HINT_QUIET_MS) {
      this.hintTo = Math.min(o.words, shown + HINT_WORDS);
      this.hints++;
      this.lastProgressAt = t;
      return this.hintTo;
    }
    return null;
  }
}

/** ModelTurn settings for a verse of `words` words the reciter took `reciterMs` to recite. */
export function modelTurnOptions(words: number, reciterMs: number, hintAfterMs: number, giveUpMs: number): ModelTurnOptions {
  const r = Number.isFinite(reciterMs) && reciterMs > 0 ? reciterMs : 10000;
  return {
    words,
    hintAfterMs,
    startHintAfterMs: hintAfterMs > 0 ? Math.max(6000, hintAfterMs) : 0,
    giveUpMs,
    notStartedMs: 30000,
    maxMs: Math.max(120000, r * 4),
  };
}
