/**
 * The memorisation loop prototype's audio: the reciter plays a verse, then you recite it, N times, then the next
 * verse. Built to compare microphone setups in a car on Bluetooth, and to measure what each costs:
 *
 * - "always": the mic opens once, at Start, and stays open; what it hears while the reciter plays is ignored.
 * - "turn": the mic opens for your turn only and is released while the reciter plays.
 * - and which mic: the system default (over Bluetooth usually the car's, which puts the car in "call" mode), or
 *   the phone's own ("Speakerphone" on Android, "iPhone Microphone" on iPhone).
 *
 * Everything that happens is logged with its timing (mic open, first sound, playback start, how far the mic hears
 * the reciter, the mic's bandwidth, route and device changes, how your turns ended), and each of your turns is
 * recorded so you can hear what the mic heard. No speech model: your turn ends after a stretch of quiet
 * (TurnGate), a tap on "I'm done", or a timeout. The car's play/pause button pauses and resumes.
 */
import workletUrl from "./level.worklet.ts?worker&url";
import { gateOptions, nextStep, NOT_A_ROOM_DB, skipVerse, TurnGate, verseAudioUrl, verseKey, type GateEnd, type Reciter, type Step, type Verse } from "./memorize";

export type MicMode = "always" | "turn";

export interface LabConfig {
  micMode: MicMode;
  /** "" = the system's default microphone */
  deviceId: string;
  /** the chosen mic's name, for the log */
  deviceLabel?: string;
  /** the browser's echo cancellation / noise suppression / gain control (the app's voice features turn these off) */
  voiceProcessing: boolean;
  reps: number;
  endSilenceMs: number;
  thresholdDb: number;
  /** a short beep when the mic is live for your turn */
  cue: boolean;
  /** wait this long after your turn before the reciter starts again */
  gapMs: number;
  /** Safari only: set navigator.audioSession.type for each turn */
  audioSessionHints: boolean;
}

export type Phase = "idle" | "starting" | "running" | "paused" | "done" | "error";
export type Activity = "loading" | "gap" | "playing" | "mic-opening" | "listening" | null;

export interface LogLine {
  /** seconds since Start */
  t: number;
  text: string;
}

export interface Recording {
  id: number;
  label: string;
  url: string;
  mime: string;
  ms: number;
}

export interface Mic {
  id: string;
  label: string;
}

export interface LabState {
  phase: Phase;
  step: Step | null;
  activity: Activity;
  level: number;
  speaking: boolean;
  floorDb: number;
  speechMs: number;
  micLabel: string | null;
  message: string | null;
  recordings: Recording[];
  logCount: number;
  /** finished runs kept for "Copy log" */
  runs: number;
}

export interface Summary {
  playLatency: number[];
  sinceRelease: number[];
  micOpen: number[];
  firstSound: number[];
  ends: Record<string, number>;
  reciterHeard: string[];
  audibleStart: number[];
  bandwidth: string[];
}

type TurnEnd = GateEnd | "tap" | "no-frames" | "aborted";

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
const MAX_RECORDINGS = 40;
const MIC_SLOW_MS = 10000;
const MIC_GIVE_UP_MS = 60000;
const NO_FRAMES_MS = 2500;
const FETCH_RETRY_MS = [1000, 3000, 8000];
const PREFETCH = 4;
const RUNS_KEY = "memorizeLab.runs";
const MAX_RUNS = 12;

/** Frequency bands for telling a Bluetooth call mic (8 or 16 kHz audio) from a full-band one. */
const BANDS = { low: [300, 3400], mid: [4300, 7000], high: [8500, 12000] } as const;
type Band = keyof typeof BANDS;

type AudioSessionType = "auto" | "playback" | "play-and-record" | "ambient" | "transient" | "transient-solo";
const audioSession = () => (navigator as unknown as { audioSession?: { type: AudioSessionType } }).audioSession;

function loadRuns(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem(RUNS_KEY) ?? "[]");
    return Array.isArray(r) ? r.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export class MemorizeLab {
  readonly log: LogLine[] = [];
  readonly summary: Summary = emptySummary();
  readonly runs: string[] = loadRuns();
  state: LabState = { phase: "idle", step: null, activity: null, level: -120, speaking: false, floorDb: -90, speechMs: 0, micLabel: null, message: null, recordings: [], logCount: 0, runs: this.runs.length };
  header: string[] = [];

  private listeners = new Set<() => void>();
  private cfg!: LabConfig;
  private verses: Verse[] = [];
  private reciter!: Reciter;
  private t0 = 0;
  /** bumped by pause, stop and skips: async work from an older generation stops where it is */
  private gen = 0;
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum: Float32Array<ArrayBuffer> | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private audio: HTMLAudioElement | null = null;
  private blobs = new Map<string, Promise<string>>();
  private reciterMs = new Map<number, number>();
  private gate: TurnGate | null = null;
  /** ends the turn in progress (and clears its timers) */
  private endTurn: ((e: TurnEnd) => void) | null = null;
  private recording: { rec: MediaRecorder; label: string | null } | null = null;
  private recordingId = 0;
  private wakeLock: WakeLockSentinel | null = null;
  /** mic timings */
  private micLiveAt = 0;
  private micReleasedAt = 0;
  private lastFrameAt = 0;
  private sawSound = false;
  private pausedByMute = false;
  /** "always" mode: the mic's 50 ms levels while the reciter plays, and when it first heard the reciter */
  private reciterBlocks: number[] = [];
  private playingAt = 0;
  private heardStart = false;
  /** the room's level in your last turn (dBFS), to compare the reciter's echo with */
  private lastNoise = NaN;
  /** the spectrum's band powers through your turn, with the level of each moment, for the bandwidth line */
  private bandSamples: ({ db: number } & Record<Band, number>)[] = [];
  private cleanup: (() => void)[] = [];

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<LabState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private now() {
    return performance.now() - this.t0;
  }

  private note(text: string) {
    this.log.push({ t: this.now() / 1000, text });
    this.set({ logCount: this.log.length });
  }

  private where(step = this.state.step) {
    if (!step) return "";
    return `${verseKey(this.verses[step.verse])} r${step.rep}`;
  }

  /** Microphones, with names once permission has been given (asks for it if needed). */
  static async listMics(): Promise<Mic[]> {
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (!devices.some((d) => d.kind === "audioinput" && d.label)) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      devices = await navigator.mediaDevices.enumerateDevices();
      s.getTracks().forEach((t) => t.stop());
    }
    return devices.filter((d) => d.kind === "audioinput").map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  }

  /** Starts the session. Call from a tap: the audio context, the player and the wake lock are unlocked inside it. */
  async start(cfg: LabConfig, verses: Verse[], reciter: Reciter) {
    if (this.state.phase === "running" || this.state.phase === "starting" || this.state.phase === "paused" || !verses.length) return;
    this.reset();
    this.cfg = cfg;
    this.verses = verses;
    this.reciter = reciter;
    this.t0 = performance.now();
    const gen = ++this.gen;

    // Inside the tap, before any await: Safari only grants these with a recent tap.
    const ctx = new AudioContext();
    this.ctx = ctx;
    void ctx.resume();
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    audio.src = SILENT_WAV;
    void audio.play().catch(() => undefined);
    this.audio = audio;
    const wake = navigator.wakeLock?.request("screen");

    this.set({ phase: "starting", step: { verse: 0, rep: 1, turn: "reciter" }, activity: "loading", message: null, recordings: [] });
    const session = audioSession();
    this.header = [
      `Itqan memorize lab · ${new Date().toISOString()}`,
      `browser: ${navigator.userAgent}`,
      `mode: mic ${cfg.micMode === "always" ? "on the whole time" : "on for my turn only"} · mic: ${cfg.deviceId ? cfg.deviceLabel || "chosen" : "system default"} · voice processing ${cfg.voiceProcessing ? "on" : "off"}`,
      `turn ends after ${cfg.endSilenceMs} ms quiet · threshold ${cfg.thresholdDb} dB · pause before reciter ${cfg.gapMs} ms · beep ${cfg.cue ? "on" : "off"} · audioSession ${session ? `hints ${cfg.audioSessionHints ? "on" : "off"}, type at start ${session.type}` : "not supported"}`,
      `plan: ${verseKey(verses[0])}–${verseKey(verses[verses.length - 1])} (${verses.length} verses) × ${cfg.reps} · reciter ${reciter.name}`,
    ];
    this.note(`start · audio context ${ctx.sampleRate} Hz, base latency ${ms(ctx.baseLatency)}, output latency ${ms(ctx.outputLatency)}`);
    this.watch(audio, ctx);
    void wake?.then(
      (w) => this.holdWakeLock(w),
      (e) => this.note(`wake lock refused: ${errorText(e)} (the screen may lock and stop the mic)`),
    );
    if (!wake) this.note("no wake lock in this browser: keep the screen on yourself");
    if (session && !cfg.audioSessionHints && session.type !== "auto") this.setSession("auto", "hints off");
    try {
      const perm = await navigator.permissions?.query({ name: "microphone" as PermissionName });
      if (perm) this.note(`mic permission before start: ${perm.state}`);
    } catch {
      /* not queryable here */
    }

    try {
      await ctx.audioWorklet.addModule(workletUrl);
      if (gen !== this.gen) return;
      const node = new AudioWorkletNode(ctx, "itqan-lab-level", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
      const mute = ctx.createGain();
      mute.gain.value = 0; // the node must reach the destination to run; nothing is played
      node.connect(mute).connect(ctx.destination);
      node.port.onmessage = (e: MessageEvent<number[]>) => this.onFrames(e.data);
      this.node = node;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      this.spectrum = new Float32Array(this.analyser.frequencyBinCount);

      this.hint("play-and-record");
      // Ask for the mic now, not in the middle of a drive. "turn" mode releases it again straight away.
      if (!(await this.openMic("start", gen))) return;
      if (this.cfg.micMode === "turn") this.closeMic("start");
      await this.listOutputs();
    } catch (e) {
      if (gen === this.gen) this.fail(e);
      return;
    }
    this.mediaSession(true);
    if (gen !== this.gen) return;
    this.set({ phase: "running" });
    void this.run({ verse: 0, rep: 1, turn: "reciter" }, gen);
  }

  /** Pause: the verse (or your turn) starts again from the beginning on resume. */
  pause(why = "tap") {
    if (this.state.phase !== "running") return;
    this.gen++;
    this.note(`pause (${why}) at ${this.where()} ${this.state.step?.turn === "you" ? "your turn" : "reciter"}`);
    this.audio?.pause();
    this.abortTurn();
    if (this.cfg.micMode === "turn") this.closeMic("pause");
    this.set({ phase: "paused", activity: null, speaking: false });
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  }

  /** Resume. Call from a tap (or the car's play button). */
  resume(why = "tap") {
    const step = this.state.step;
    if (this.state.phase !== "paused" || !step) return;
    this.pausedByMute = false;
    void this.ctx?.resume();
    this.note(`resume (${why})`);
    this.set({ phase: "running" });
    void this.run(step, ++this.gen);
  }

  /** Ends your turn now. */
  done() {
    if (this.state.activity === "listening") this.endTurn?.("tap");
  }

  /** Jumps to the next verse. */
  skip(why = "tap") {
    const step = this.state.step;
    if (!step || (this.state.phase !== "running" && this.state.phase !== "paused")) return;
    this.gen++;
    this.audio?.pause();
    this.abortTurn();
    if (this.cfg.micMode === "turn") this.closeMic("skip");
    const next = skipVerse(step, this.verses.length);
    this.note(`skip (${why}) from ${this.where()}`);
    if (!next) return this.finish();
    this.set({ phase: "running" });
    void this.run(next, ++this.gen);
  }

  /** Starts the current verse's repetition again with the reciter. */
  again(why = "tap") {
    const step = this.state.step;
    if (!step || (this.state.phase !== "running" && this.state.phase !== "paused")) return;
    this.gen++;
    this.audio?.pause();
    this.abortTurn();
    if (this.cfg.micMode === "turn") this.closeMic("again");
    this.note(`again (${why}) at ${this.where()}`);
    this.set({ phase: "running" });
    void this.run({ ...step, turn: "reciter" }, ++this.gen);
  }

  stop() {
    if (this.state.phase === "idle" || this.state.phase === "done" || this.state.phase === "error") return;
    this.note("stop");
    this.finish("idle");
  }

  /** Every kept run's report, oldest first, for pasting into a chat. */
  allReports(): string {
    return this.runs.join("\n\n════════════════════════════════════════\n\n");
  }

  clearRuns() {
    this.runs.length = 0;
    this.saveRuns();
  }

  private keepRun() {
    if (!this.log.length) return;
    this.runs.push(this.report());
    while (this.runs.length > MAX_RUNS) this.runs.shift();
    this.saveRuns();
  }

  private saveRuns() {
    try {
      localStorage.setItem(RUNS_KEY, JSON.stringify(this.runs));
    } catch {
      /* storage full or blocked: the runs still last for this visit */
    }
    this.set({ runs: this.runs.length });
  }

  private finish(phase: Phase = "done") {
    this.gen++;
    this.audio?.pause();
    this.abortTurn();
    this.closeMic("end");
    if (phase === "done") this.note("done: every verse recited");
    this.teardown();
    this.set({ phase, activity: null, speaking: false, level: -120 });
    this.keepRun();
  }

  private fail(e: unknown) {
    const message = errorText(e);
    this.note(`error · ${message}`);
    this.gen++;
    this.audio?.pause();
    this.abortTurn();
    this.closeMic("error");
    this.teardown();
    this.set({ phase: "error", activity: null, message });
    this.keepRun();
  }

  private reset() {
    this.log.length = 0;
    Object.assign(this.summary, emptySummary());
    this.state.recordings.forEach((r) => URL.revokeObjectURL(r.url));
    this.reciterMs.clear();
    this.lastNoise = NaN;
    this.pausedByMute = false;
  }

  private teardown() {
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.node?.disconnect();
    this.node = null;
    this.analyser = null;
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close();
    this.ctx = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.audio = null;
    for (const p of this.blobs.values()) void p.then((u) => URL.revokeObjectURL(u), () => undefined);
    this.blobs.clear();
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    this.mediaSession(false);
    // never leave Safari's audio session forced: the next run (or the rest of the app) would inherit it
    const s = audioSession();
    if (s && s.type !== "auto") this.setSession("auto", "end");
  }

  private holdWakeLock(w: WakeLockSentinel) {
    if (this.state.phase !== "running" && this.state.phase !== "starting" && this.state.phase !== "paused") {
      void w.release().catch(() => undefined);
      return;
    }
    this.wakeLock = w;
    this.note("wake lock held: the screen stays on");
    w.addEventListener("release", () => {
      if (this.wakeLock === w) this.note("wake lock released by the browser");
    });
  }

  /** Logs what the browser and the devices do while the session runs. */
  private watch(audio: HTMLAudioElement, ctx: AudioContext) {
    const on = <T extends EventTarget>(target: T, type: string, fn: (e: Event) => void) => {
      target.addEventListener(type, fn);
      this.cleanup.push(() => target.removeEventListener(type, fn));
    };
    for (const type of ["stalled", "error"]) {
      on(audio, type, () => {
        if (audio.src.startsWith("data:")) return;
        this.note(`player ${type}${type === "error" && audio.error ? ` (${audio.error.code} ${audio.error.message})` : ""}`);
      });
    }
    on(ctx, "statechange", () => this.note(`audio context ${ctx.state}`));
    on(navigator.mediaDevices, "devicechange", () => {
      this.note("devices changed");
      void this.listOutputs(true);
    });
    on(document, "visibilitychange", () => {
      this.note(`page ${document.visibilityState}`);
      if (document.visibilityState === "visible" && (this.state.phase === "running" || this.state.phase === "paused")) {
        void navigator.wakeLock?.request("screen").then(
          (w) => this.holdWakeLock(w),
          (e) => this.note(`wake lock refused again: ${errorText(e)}`),
        );
      }
    });
  }

  private async listOutputs(changed = false) {
    try {
      const d = await navigator.mediaDevices.enumerateDevices();
      const names = (kind: MediaDeviceKind) => d.filter((x) => x.kind === kind).map((x) => x.label || "(unnamed)").join(" | ") || "none listed";
      this.note(`${changed ? "now " : ""}inputs: ${names("audioinput")}`);
      this.note(`${changed ? "now " : ""}outputs: ${names("audiooutput")}`);
    } catch {
      /* not important */
    }
  }

  private hint(type: AudioSessionType) {
    const s = audioSession();
    if (!this.cfg.audioSessionHints || !s || s.type === type) return;
    this.setSession(type);
  }

  private setSession(type: AudioSessionType, why?: string) {
    const s = audioSession();
    if (!s) return;
    try {
      s.type = type;
      this.note(`audioSession → ${type}${why ? ` (${why})` : ""}`);
    } catch (e) {
      this.note(`audioSession → ${type} failed: ${errorText(e)}`);
    }
  }

  private mediaSession(on: boolean) {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, fn: (() => void) | null) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* unsupported action */
      }
    };
    // The car's (or headphones') buttons. Every press is logged before anything else, so a press that does
    // nothing still shows up. Play and pause are one toggle: the car decides which to send from the player's
    // state, which says "paused" during your turn even though the session is running.
    const handler = (action: string, fn: () => void) => () => {
      this.note(`car button: ${action} (${this.state.phase}${this.state.activity ? `, ${this.state.activity}` : ""})`);
      fn();
    };
    const toggle = () => (this.state.phase === "paused" ? this.resume("car button") : this.pause("car button"));
    set("play", on ? handler("play", toggle) : null);
    set("pause", on ? handler("pause", toggle) : null);
    set("stop", on ? handler("stop", () => this.pause("car button")) : null);
    set("nexttrack", on ? handler("next", () => this.skip("car button")) : null);
    set("previoustrack", on ? handler("previous", () => this.again("car button")) : null);
    ms.playbackState = on ? "playing" : "none";
    if (!on) ms.metadata = null;
  }

  private showStep(step: Step) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = "playing";
    if (typeof MediaMetadata === "undefined") return;
    const v = this.verses[step.verse];
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${verseKey(v)} · ${step.turn === "you" ? "your turn" : "listen"} · ${step.rep} of ${this.cfg.reps}`,
      artist: this.reciter.name,
      album: "Itqān · memorize",
    });
  }

  /** The verse's audio as an object URL, fetched once per session. */
  private verseAudio(i: number): Promise<string> {
    const url = verseAudioUrl(this.reciter, this.verses[i]);
    let p = this.blobs.get(url);
    if (!p) {
      const t = performance.now();
      p = fetch(url, { mode: "cors" }).then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} for ${url}`);
        const blob = await r.blob();
        this.note(`fetched ${verseKey(this.verses[i])} (${(blob.size / 1024).toFixed(0)} KB) in ${(performance.now() - t).toFixed(0)} ms`);
        return URL.createObjectURL(blob);
      });
      p.catch(() => this.blobs.delete(url));
      this.blobs.set(url, p);
    }
    return p;
  }

  /** The verse's audio, retrying through a dead zone (1, 3, 8 s) before giving up. */
  private async verseAudioWithRetry(i: number, gen: number): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.verseAudio(i);
      } catch (e) {
        if (gen !== this.gen) return null;
        if (attempt >= FETCH_RETRY_MS.length) throw e;
        this.note(`couldn't fetch ${verseKey(this.verses[i])} (${errorText(e)}); trying again in ${FETCH_RETRY_MS[attempt] / 1000} s`);
        await sleep(FETCH_RETRY_MS[attempt]);
        if (gen !== this.gen) return null;
      }
    }
  }

  private async run(step: Step | null, gen: number) {
    while (step && gen === this.gen) {
      this.set({ step });
      this.showStep(step);
      try {
        const ok = step.turn === "reciter" ? await this.reciterTurn(step, gen) : await this.yourTurn(step, gen);
        if (!ok || gen !== this.gen) return;
      } catch (e) {
        if (gen === this.gen) this.fail(e);
        return;
      }
      step = nextStep(step, this.verses.length, this.cfg.reps);
    }
    if (gen === this.gen && !step) this.finish();
  }

  private async reciterTurn(step: Step, gen: number): Promise<boolean> {
    const audio = this.audio!;
    this.set({ activity: "loading", speaking: false });
    // the next verses load while this one plays
    for (let k = 1; k <= PREFETCH && step.verse + k < this.verses.length; k++) void this.verseAudio(step.verse + k).catch(() => undefined);
    const src = await this.verseAudioWithRetry(step.verse, gen);
    if (!src || gen !== this.gen) return false;
    const afterTurn = step.rep > 1 || step.verse > 0;
    if (this.cfg.gapMs > 0 && afterTurn) {
      this.set({ activity: "gap" });
      await sleep(this.cfg.gapMs);
      if (gen !== this.gen) return false;
    }
    if (this.cfg.micMode === "turn") this.hint("playback");
    this.reciterBlocks = [];
    this.heardStart = false;

    // Played until 'ended'. If the system pauses the player (Bluetooth dropped, a call, another app), the session
    // pauses too, so the car's play button can resume it; if it never finishes, it moves on after a while.
    const result = await new Promise<"ended" | "stopped">((resolve, reject) => {
      let started = false;
      let stuck: ReturnType<typeof setTimeout> | null = null;
      const off = () => {
        audio.removeEventListener("ended", onEnded);
        audio.removeEventListener("error", onError);
        audio.removeEventListener("pause", onPause);
        audio.removeEventListener("playing", onPlaying);
        if (stuck) clearTimeout(stuck);
      };
      const onEnded = () => {
        off();
        resolve("ended");
      };
      const onError = () => {
        off();
        reject(new Error(`couldn't play ${verseKey(this.verses[step.verse])}${audio.error ? ` (${audio.error.message || audio.error.code})` : ""}`));
      };
      const onPause = () => {
        if (audio.ended || !started) return;
        off();
        if (gen === this.gen && this.state.phase === "running") {
          this.note(`player paused by the system at ${fmtS(audio.currentTime)}`);
          this.pause("system");
        }
        resolve("stopped");
      };
      const onPlaying = () => {
        if (gen !== this.gen || started) return;
        started = true;
        const at = performance.now();
        this.playingAt = at;
        const lat = at - t;
        this.summary.playLatency.push(lat);
        const d = audio.duration;
        if (Number.isFinite(d)) this.reciterMs.set(step.verse, d * 1000);
        let since = "";
        if (this.cfg.micMode === "turn" && this.micReleasedAt) {
          const s = t - this.micReleasedAt;
          this.summary.sinceRelease.push(s);
          since = ` · ${s.toFixed(0)} ms after the mic was released`;
        }
        this.note(`reciter ${this.where(step)} · playing after ${lat.toFixed(0)} ms (${fmtS(d)})${since}${d < 5 ? " · under 5 s: Android may not treat it as media (car buttons)" : ""}`);
        if (stuck) clearTimeout(stuck);
        stuck = setTimeout(() => {
          off();
          if (gen !== this.gen) return resolve("stopped");
          this.note(`the verse didn't finish playing (${fmtS(audio.currentTime)} of ${fmtS(d)}); moving on`);
          resolve("ended");
        }, (Number.isFinite(d) ? d * 1000 : 60000) + 8000);
      };
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
      audio.addEventListener("pause", onPause);
      audio.addEventListener("playing", onPlaying);
      audio.src = src;
      const t = performance.now();
      stuck = setTimeout(() => {
        off();
        if (gen !== this.gen) return resolve("stopped");
        reject(new Error(`the verse didn't start playing within 20 s (${audio.error?.message || `ready state ${audio.readyState}`})`));
      }, 20000);
      this.set({ activity: "playing" });
      audio.play().catch((e) => {
        off();
        if (gen !== this.gen) return resolve("stopped");
        reject(e);
      });
    });
    if (result !== "ended" || gen !== this.gen) return false;
    this.reportReciterHeard();
    return true;
  }

  /** "always" mode: how loud the mic heard the reciter, against the room as heard in your last turn. */
  private reportReciterHeard() {
    if (this.cfg.micMode !== "always" || !this.reciterBlocks.length || !Number.isFinite(this.lastNoise)) return;
    const s = [...this.reciterBlocks].sort((a, b) => a - b);
    const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] - this.lastNoise;
    const line = `median ${p(0.5).toFixed(0)} dB, loud parts ${p(0.9).toFixed(0)} dB above the room`;
    this.summary.reciterHeard.push(`${p(0.5).toFixed(0)}/${p(0.9).toFixed(0)}`);
    this.note(`mic heard the reciter: ${line}`);
  }

  private async yourTurn(step: Step, gen: number): Promise<boolean> {
    if (this.stream?.getAudioTracks()[0]?.readyState === "ended") this.closeMic("its track had ended");
    if (!this.stream) {
      this.set({ activity: "mic-opening" });
      this.hint("play-and-record");
      if (!(await this.openMic(this.where(step), gen))) return false;
    }
    const stream = this.stream;
    if (!stream) throw new Error("the microphone is not open");
    if (this.cfg.cue) this.beep();
    const ctx = this.ctx;
    // the beep travels out through the car and back in through the mic: ignore it
    const guard = this.cfg.cue && ctx ? Math.max(800, 330 + 1000 * ((ctx.baseLatency || 0) + (ctx.outputLatency || 0.3))) : 400;
    const opts = gateOptions(this.reciterMs.get(step.verse) ?? NaN, this.cfg.endSilenceMs, this.cfg.thresholdDb, guard, this.lastNoise);
    const gate = new TurnGate(opts);
    this.gate = gate;
    this.bandSamples = [];
    this.startRecording(stream);
    this.lastFrameAt = performance.now();
    this.set({ activity: "listening", speaking: false, speechMs: 0 });
    const end = await new Promise<TurnEnd>((resolve) => {
      // if audio frames stop arriving (capture paused by the system, the audio context interrupted), say so
      const watchdog = setInterval(() => {
        if (performance.now() - this.lastFrameAt < NO_FRAMES_MS) return;
        this.note(`no audio from the mic for ${NO_FRAMES_MS / 1000} s (audio context ${this.ctx?.state ?? "gone"})`);
        void this.ctx?.resume();
        finish("no-frames");
      }, 500);
      const finish = (e: TurnEnd) => {
        clearInterval(watchdog);
        if (this.endTurn === finish) this.endTurn = null;
        resolve(e);
      };
      this.endTurn = finish;
    });
    if (gen !== this.gen || end === "aborted") return false;
    this.gate = null;
    const room = gate.roomDb();
    if (Number.isFinite(room)) this.lastNoise = room;
    this.summary.ends[end] = (this.summary.ends[end] ?? 0) + 1;
    const st = gate.status;
    this.note(
      `your turn ${this.where(step)} · ended by ${end} after ${fmtS(gate.elapsedMs / 1000)}` +
        ` · speech ${fmtS(st.speechMs / 1000)}${st.firstSpeechAt !== null ? `, first at ${fmtS(st.firstSpeechAt / 1000)}` : ""}` +
        ` · room ${Number.isFinite(room) ? `${room.toFixed(0)} dB` : "?"} · guard ${guard.toFixed(0)} ms`,
    );
    this.reportBandwidth(st.floorDb);
    this.stopRecording(`${verseKey(this.verses[step.verse])} r${step.rep} · ${end}`);
    if (this.cfg.micMode === "turn") this.closeMic(this.where(step));
    this.set({ speaking: false });
    return true;
  }

  private abortTurn() {
    this.gate = null;
    this.endTurn?.("aborted");
    this.endTurn = null;
    this.stopRecording(null);
  }

  /** Opens the mic; false (and the mic released again) if the session moved on while it was opening. */
  private async openMic(why: string, gen: number): Promise<boolean> {
    if (this.stream) return true;
    const audio: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: this.cfg.voiceProcessing,
      noiseSuppression: this.cfg.voiceProcessing,
      autoGainControl: this.cfg.voiceProcessing,
      ...(this.cfg.deviceId ? { deviceId: { exact: this.cfg.deviceId } } : {}),
    };
    const t = performance.now();
    const req = navigator.mediaDevices.getUserMedia({ audio });
    // Slow is not fatal (a permission prompt, the page hidden): say so, and only give up after a minute. A
    // stream that arrives after that, or after the session moved on, is released at once.
    const slow = setTimeout(() => this.note(`mic still not open after ${MIC_SLOW_MS / 1000} s (a permission prompt? the screen locked?)`), MIC_SLOW_MS);
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      giveUp = setTimeout(() => reject(new Error(`the microphone didn't open within ${MIC_GIVE_UP_MS / 1000} s`)), MIC_GIVE_UP_MS);
    });
    let stream: MediaStream;
    try {
      stream = await Promise.race([req, timeout]);
    } catch (e) {
      void req.then(
        (late) => {
          late.getTracks().forEach((tr) => tr.stop());
          this.note("a late microphone was released");
        },
        () => undefined,
      );
      if (e instanceof DOMException && e.name === "OverconstrainedError") {
        throw new Error("the chosen microphone isn't available now: pick another one, or System default");
      }
      throw e;
    } finally {
      clearTimeout(slow);
      clearTimeout(giveUp);
    }
    const openMs = performance.now() - t;
    if (gen !== this.gen) {
      stream.getTracks().forEach((tr) => tr.stop());
      this.note(`mic opened after the session moved on (${why}); released`);
      return false;
    }
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    const s = track.getSettings() as MediaTrackSettings & { sampleRate?: number; latency?: number };
    if (why === "start") {
      this.note(`mic first open in ${openMs.toFixed(0)} ms (includes the permission prompt, if one was shown)`);
    } else {
      this.summary.micOpen.push(openMs);
      this.note(`mic open (${why}) in ${openMs.toFixed(0)} ms`);
    }
    this.note(
      `mic: "${track.label}" · ${s.sampleRate ?? "?"} Hz (audio context ${this.ctx?.sampleRate ?? "?"} Hz)` +
        `${s.latency !== undefined ? ` · latency ${ms(s.latency)}` : ""} · echo cancellation ${s.echoCancellation ? "on" : "off"}`,
    );
    this.set({ micLabel: track.label || "microphone" });
    track.addEventListener("ended", () => this.note("mic track ended"));
    track.addEventListener("mute", () => this.onMute(track));
    track.addEventListener("unmute", () => {
      this.note("mic track unmuted");
      if (this.pausedByMute && this.state.phase === "paused") this.resume("mic unmuted");
    });
    if (this.ctx && this.node) {
      this.node.port.postMessage("reset");
      this.source = this.ctx.createMediaStreamSource(stream);
      this.source.connect(this.node);
      if (this.analyser) this.source.connect(this.analyser);
    }
    this.micLiveAt = performance.now();
    this.sawSound = false;
    return true;
  }

  /** iOS mutes the mic while the page is hidden (screen locked): pause, and carry on when it comes back. */
  private onMute(track: MediaStreamTrack) {
    this.note("mic track muted");
    setTimeout(() => {
      if (!track.muted || track.readyState === "ended" || this.state.phase !== "running") return;
      this.pausedByMute = true;
      this.pause("mic muted by the system: screen locked or page hidden?");
    }, 1000);
  }

  private closeMic(why: string) {
    if (!this.stream) return;
    this.source?.disconnect();
    this.source = null;
    this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.micReleasedAt = performance.now();
    this.note(`mic released (${why})`);
    this.set({ level: -120, micLabel: null });
  }

  private onFrames(dbs: number[]) {
    const now = performance.now();
    this.lastFrameAt = now;
    if (!this.sawSound && dbs.some((db) => db > NOT_A_ROOM_DB)) {
      this.sawSound = true;
      const d = now - this.micLiveAt;
      this.summary.firstSound.push(d);
      this.note(`first sound from the mic ${d.toFixed(0)} ms after it opened`);
    }
    const level = Math.max(...dbs);
    const block = 10 * Math.log10(dbs.reduce((a, db) => a + 10 ** (db / 10), 0) / dbs.length);
    if (this.state.activity === "playing" && this.cfg.micMode === "always" && block > NOT_A_ROOM_DB) {
      this.reciterBlocks.push(block);
      if (!this.heardStart && Number.isFinite(this.lastNoise) && block > this.lastNoise + this.cfg.thresholdDb) {
        this.heardStart = true;
        const d = now - this.playingAt;
        this.summary.audibleStart.push(d);
        this.note(`the mic heard the reciter start ${d.toFixed(0)} ms after 'playing' (output latency, Bluetooth included)`);
      }
    }
    const g = this.gate;
    if (g && this.state.activity === "listening") {
      let st = g.status;
      for (const db of dbs) st = g.push(db);
      if (g.elapsedMs > g.opts.guardMs && block > NOT_A_ROOM_DB) this.sampleBands(block);
      this.set({ level, speaking: st.speaking, floorDb: st.floorDb, speechMs: st.speechMs });
      if (st.end) this.endTurn?.(st.end);
    } else {
      this.set({ level });
    }
  }

  /** Records the current spectrum's band powers with the moment's level (sorted into speech and quiet at the end). */
  private sampleBands(db: number) {
    const a = this.analyser;
    const buf = this.spectrum;
    if (!a || !buf || this.bandSamples.length >= 6000) return;
    a.getFloatFrequencyData(buf);
    const hzPerBin = a.context.sampleRate / a.fftSize;
    const sample = { db, low: 0, mid: 0, high: 0 };
    for (const band of Object.keys(BANDS) as Band[]) {
      const [lo, hi] = BANDS[band];
      for (let i = Math.ceil(lo / hzPerBin); i <= Math.floor(hi / hzPerBin) && i < buf.length; i++) sample[band] += 10 ** (buf[i] / 10);
    }
    this.bandSamples.push(sample);
  }

  /**
   * How much your speech raised each band above the quiet in the same band. A Bluetooth call mic carries nothing
   * above ~4 kHz (CVSD, 8 kHz audio) or ~8 kHz (mSBC, 16 kHz audio): speech can't raise those bands.
   */
  private reportBandwidth(floorDb: number) {
    // sorted with the turn's final noise floor, which knows the room even if you started reciting at once
    const speech = this.bandSamples.filter((x) => x.db > floorDb + this.cfg.thresholdDb);
    const quiet = this.bandSamples.filter((x) => x.db <= floorDb + 3);
    const nyquist = (this.ctx?.sampleRate ?? 48000) / 2;
    if (speech.length < 10 || quiet.length < 5) return this.note("mic bandwidth: not enough speech and quiet to tell");
    const mean = (xs: typeof speech, b: Band) => xs.reduce((a, x) => a + x[b], 0) / xs.length;
    const rise = (b: Band) => 10 * Math.log10(mean(speech, b) / Math.max(mean(quiet, b), 1e-20));
    const low = rise("low");
    const mid = rise("mid");
    const high = nyquist >= BANDS.high[1] ? rise("high") : NaN;
    let verdict: string;
    if (low < 6) verdict = "can't tell (speech barely above the room)";
    else if (mid < 3) verdict = "narrowband: nothing above ~4 kHz, Bluetooth call audio (CVSD)";
    else if (Number.isFinite(high) && high < 3) verdict = "wideband: nothing above ~8 kHz, Bluetooth call audio (mSBC)";
    else if (Number.isFinite(high)) verdict = "full band: the phone's own mic (or LC3 Bluetooth)";
    else verdict = `at least wideband (can't see above ${(nyquist / 1000).toFixed(0)} kHz)`;
    this.summary.bandwidth.push(verdict.split(":")[0]);
    this.note(
      `mic bandwidth: speech raises 0.3–3.4 kHz by ${low.toFixed(0)} dB, 4.3–7 kHz by ${mid.toFixed(0)} dB` +
        `${Number.isFinite(high) ? `, 8.5–12 kHz by ${high.toFixed(0)} dB` : ""} → ${verdict}`,
    );
  }

  private beep() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.2, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  private startRecording(stream: MediaStream) {
    if (typeof MediaRecorder === "undefined") return;
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
    try {
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const recording = { rec, label: null as string | null };
      const chunks: Blob[] = [];
      const started = performance.now();
      rec.ondataavailable = (e) => void (e.data.size && chunks.push(e.data));
      rec.onstop = () => {
        const label = recording.label;
        if (!label || !chunks.length) return;
        const blob = new Blob(chunks, { type: rec.mimeType || mime || "audio/webm" });
        const r: Recording = { id: ++this.recordingId, label, url: URL.createObjectURL(blob), mime: blob.type, ms: performance.now() - started };
        const list = [...this.state.recordings, r];
        while (list.length > MAX_RECORDINGS) URL.revokeObjectURL(list.shift()!.url);
        this.set({ recordings: list });
      };
      rec.start();
      this.recording = recording;
    } catch (e) {
      this.note(`recording unavailable: ${errorText(e)}`);
    }
  }

  /** Stops the recording of your turn; a null label discards it. */
  private stopRecording(label: string | null) {
    const r = this.recording;
    this.recording = null;
    if (!r || r.rec.state === "inactive") return;
    r.label = label;
    r.rec.stop();
  }

  /** This run's log as text. */
  report(): string {
    const s = this.summary;
    const stat = (name: string, xs: number[]) => (xs.length ? `${name}: median ${median(xs).toFixed(0)} ms, max ${Math.max(...xs).toFixed(0)} ms (${xs.length})` : `${name}: –`);
    const list = (name: string, xs: string[]) => `${name}: ${xs.length ? xs.join(", ") : "–"}`;
    return [
      ...this.header,
      "",
      "summary",
      `  ${stat("reciter playing after play() (media pipeline only)", s.playLatency)}`,
      `  ${stat("reciter started after the mic was released (turn mode)", s.sinceRelease)}`,
      `  ${stat("mic took to open for your turn (turn mode)", s.micOpen)}`,
      `  ${stat("first sound from the mic after it opened", s.firstSound)}`,
      `  ${stat("mic heard the reciter start after 'playing' (always mode)", s.audibleStart)}`,
      `  ${list("mic heard the reciter, dB above the room, median/loud (always mode)", s.reciterHeard)}`,
      `  ${list("mic bandwidth per turn", s.bandwidth)}`,
      `  your turns ended by: ${Object.entries(s.ends).map(([k, v]) => `${k} ${v}`).join(", ") || "–"}`,
      "",
      ...this.log.map((l) => `${l.t.toFixed(2).padStart(7)}  ${l.text}`),
    ].join("\n");
  }
}

function emptySummary(): Summary {
  return { playLatency: [], sinceRelease: [], micOpen: [], firstSound: [], ends: {}, reciterHeard: [], audibleStart: [], bandwidth: [] };
}

function errorText(e: unknown): string {
  if (e instanceof DOMException && e.name === "OverconstrainedError") return `OverconstrainedError (${(e as DOMException & { constraint?: string }).constraint ?? "?"})`;
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ms = (s: number | undefined) => (s === undefined || !Number.isFinite(s) ? "?" : `${(s * 1000).toFixed(0)} ms`);
const fmtS = (s: number) => (Number.isFinite(s) ? `${s.toFixed(1)} s` : "?");
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
