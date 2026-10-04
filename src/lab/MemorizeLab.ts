/**
 * The memorisation loop prototype's audio: the reciter plays a verse, then you recite it, N times, then the next
 * verse. Built to compare two microphone setups in a car on Bluetooth, and to measure what each costs:
 *
 * - "always": the mic opens once, at Start, and stays open; what it hears while the reciter plays is ignored.
 * - "turn": the mic opens for your turn only and is released while the reciter plays.
 *
 * Everything that happens is logged with its timing (mic open time, first audio, playback start, route and
 * device changes, how your turns ended), and each of your turns is recorded so you can hear what the mic heard.
 * No speech model: your turn ends after a stretch of quiet (TurnGate), a tap, or the car's play/pause buttons.
 */
import workletUrl from "./level.worklet.ts?worker&url";
import { gateOptions, nextStep, skipVerse, TurnGate, verseAudioUrl, verseKey, type GateEnd, type Reciter, type Step, type Verse } from "./memorize";

export type MicMode = "always" | "turn";

export interface LabConfig {
  micMode: MicMode;
  /** "" = the system's default microphone */
  deviceId: string;
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
}

export interface Summary {
  playLatency: number[];
  micOpen: number[];
  firstFrame: number[];
  firstSound: number[];
  ends: Record<string, number>;
  reciterHeardDb: number[];
}

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
const MAX_RECORDINGS = 40;
const MIC_OPEN_TIMEOUT_MS = 10000;

type AudioSessionType = "auto" | "playback" | "play-and-record" | "ambient" | "transient" | "transient-solo";
const audioSession = () => (navigator as unknown as { audioSession?: { type: AudioSessionType } }).audioSession;

export class MemorizeLab {
  state: LabState = { phase: "idle", step: null, activity: null, level: -120, speaking: false, floorDb: -90, speechMs: 0, micLabel: null, message: null, recordings: [], logCount: 0 };
  readonly log: LogLine[] = [];
  readonly summary: Summary = { playLatency: [], micOpen: [], firstFrame: [], firstSound: [], ends: {}, reciterHeardDb: [] };
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
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private audio: HTMLAudioElement | null = null;
  private blobs = new Map<string, Promise<string>>();
  private reciterMs = new Map<number, number>();
  private gate: TurnGate | null = null;
  private turnDone: ((end: GateEnd | "tap" | "clock") => void) | null = null;
  private recording: { rec: MediaRecorder; label: string | null } | null = null;
  private recordingId = 0;
  private wakeLock: WakeLockSentinel | null = null;
  /** mic timings for the turn in progress */
  private micLiveAt = 0;
  private sawFrame = false;
  private sawSound = false;
  /** "always" mode: the loudest the mic heard the reciter, against your turns' noise floor */
  private reciterPeak = -120;
  private lastFloor: number | null = null;
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

  /** Starts the session. Call from a tap: the audio context and the player are unlocked inside it. */
  async start(cfg: LabConfig, verses: Verse[], reciter: Reciter) {
    if (this.state.phase === "running" || this.state.phase === "starting" || !verses.length) return;
    this.reset();
    this.cfg = cfg;
    this.verses = verses;
    this.reciter = reciter;
    this.t0 = performance.now();
    const gen = ++this.gen;

    // Unlocked synchronously inside the tap, before any await.
    const ctx = new AudioContext();
    this.ctx = ctx;
    void ctx.resume();
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.preload = "auto";
    audio.src = SILENT_WAV;
    void audio.play().catch(() => undefined);
    this.audio = audio;

    this.set({ phase: "starting", step: { verse: 0, rep: 1, turn: "reciter" }, activity: "loading", message: null, recordings: [] });
    this.header = [
      `Itqan memorize lab · ${new Date().toISOString()}`,
      `browser: ${navigator.userAgent}`,
      `mode: mic ${cfg.micMode === "always" ? "on the whole time" : "on for my turn only"} · mic: ${cfg.deviceId ? "chosen" : "default"} · voice processing ${cfg.voiceProcessing ? "on" : "off"} · end after ${cfg.endSilenceMs} ms quiet · threshold ${cfg.thresholdDb} dB · gap ${cfg.gapMs} ms · cue ${cfg.cue ? "on" : "off"} · audioSession hints ${cfg.audioSessionHints ? "on" : "off"}${audioSession() ? "" : " (not supported here)"}`,
      `plan: ${verseKey(verses[0])}–${verseKey(verses[verses.length - 1])} (${verses.length} verses) × ${cfg.reps} · reciter ${reciter.name}`,
    ];
    this.note(`start · audio context ${ctx.sampleRate} Hz, base latency ${ms(ctx.baseLatency)}, output latency ${ms(ctx.outputLatency)}`);
    this.watch(audio, ctx);

    try {
      await ctx.audioWorklet.addModule(workletUrl);
      if (gen !== this.gen) return;
      const node = new AudioWorkletNode(ctx, "itqan-lab-level", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
      const mute = ctx.createGain();
      mute.gain.value = 0; // the node must reach the destination to run; nothing is played
      node.connect(mute).connect(ctx.destination);
      node.port.onmessage = (e: MessageEvent<number[]>) => this.onFrames(e.data);
      this.node = node;

      this.hint("play-and-record");
      // Ask for the mic now, not in the middle of a drive. "turn" mode releases it again straight away.
      if (!(await this.openMic("start", gen))) return;
      if (this.cfg.micMode === "turn") this.closeMic("start");
      await this.listOutputs();
    } catch (e) {
      return this.fail(e);
    }
    this.wakeLock = (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;
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
    void this.ctx?.resume();
    this.note(`resume (${why})`);
    this.set({ phase: "running" });
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    void this.run(step, ++this.gen);
  }

  /** Ends your turn now. */
  done() {
    if (this.state.activity === "listening") this.turnDone?.("tap");
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
    if (this.state.phase === "idle") return;
    this.note("stop");
    this.finish("idle");
  }

  private finish(phase: Phase = "done") {
    this.gen++;
    this.audio?.pause();
    this.abortTurn();
    this.closeMic("end");
    this.teardown();
    if (phase === "done") this.note("done: every verse recited");
    this.set({ phase, activity: null, speaking: false, level: -120 });
  }

  private fail(e: unknown) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    this.note(`error · ${message}`);
    this.gen++;
    this.abortTurn();
    this.closeMic("error");
    this.teardown();
    this.set({ phase: "error", activity: null, message });
  }

  private reset() {
    this.log.length = 0;
    this.summary.playLatency = [];
    this.summary.micOpen = [];
    this.summary.firstFrame = [];
    this.summary.firstSound = [];
    this.summary.ends = {};
    this.summary.reciterHeardDb = [];
    this.state.recordings.forEach((r) => URL.revokeObjectURL(r.url));
    this.reciterMs.clear();
    this.lastFloor = null;
  }

  private teardown() {
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.node?.disconnect();
    this.node = null;
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
        void navigator.wakeLock?.request("screen").then((w) => (this.wakeLock = w), () => undefined);
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
    try {
      s.type = type;
      this.note(`audioSession → ${type}`);
    } catch (e) {
      this.note(`audioSession → ${type} failed: ${e}`);
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
    // The car's (or headphones') buttons: play/pause, next = next verse, previous = this verse again.
    set("play", on ? () => this.resume("car button") : null);
    set("pause", on ? () => this.pause("car button") : null);
    set("nexttrack", on ? () => this.skip("car button") : null);
    set("previoustrack", on ? () => this.again("car button") : null);
    ms.playbackState = on ? "playing" : "none";
    if (!on) ms.metadata = null;
  }

  private showStep(step: Step) {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
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
    for (let k = 1; k <= 2 && step.verse + k < this.verses.length; k++) void this.verseAudio(step.verse + k).catch(() => undefined);
    const src = await this.verseAudio(step.verse).catch(() => this.verseAudio(step.verse)); // one retry
    if (gen !== this.gen) return false;
    const afterTurn = step.rep > 1 || step.verse > 0;
    if (this.cfg.gapMs > 0 && afterTurn) {
      this.set({ activity: "gap" });
      await sleep(this.cfg.gapMs);
      if (gen !== this.gen) return false;
    }
    if (this.cfg.micMode === "turn") this.hint("playback");
    this.reciterPeak = -120;
    const ended = new Promise<void>((resolve, reject) => {
      const done = () => {
        audio.removeEventListener("ended", done);
        audio.removeEventListener("error", fail);
        resolve();
      };
      const fail = () => {
        audio.removeEventListener("ended", done);
        audio.removeEventListener("error", fail);
        reject(new Error(`couldn't play ${verseKey(this.verses[step.verse])}`));
      };
      audio.addEventListener("ended", done);
      audio.addEventListener("error", fail);
    });
    ended.catch(() => undefined); // awaited below, unless this turn is abandoned first
    const playing = new Promise<number>((resolve) => audio.addEventListener("playing", () => resolve(performance.now()), { once: true }));
    audio.src = src;
    const t = performance.now();
    this.set({ activity: "playing" });
    await audio.play();
    const at = await playing;
    if (gen !== this.gen) return false;
    const lat = at - t;
    this.summary.playLatency.push(lat);
    if (Number.isFinite(audio.duration)) this.reciterMs.set(step.verse, audio.duration * 1000);
    this.note(`reciter ${this.where(step)} · playing after ${lat.toFixed(0)} ms (${fmtS(audio.duration)})`);
    await ended;
    if (gen !== this.gen) return false;
    if (this.cfg.micMode === "always" && this.lastFloor !== null && this.reciterPeak > -120) {
      const heard = this.reciterPeak - this.lastFloor;
      this.summary.reciterHeardDb.push(heard);
      this.note(`mic heard the reciter at up to ${heard.toFixed(0)} dB above your noise floor`);
    }
    return true;
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
    const opts = gateOptions(this.reciterMs.get(step.verse) ?? NaN, this.cfg.endSilenceMs, this.cfg.thresholdDb);
    this.gate = new TurnGate(opts);
    this.startRecording(stream);
    this.set({ activity: "listening", speaking: false, speechMs: 0 });
    const end = await new Promise<GateEnd | "tap" | "clock">((resolve) => {
      // a clock fallback, in case audio frames stop arriving (e.g. capture paused in the background)
      const clock = setTimeout(() => resolve("clock"), opts.maxMs + 3000);
      this.turnDone = (e) => {
        clearTimeout(clock);
        resolve(e);
      };
    });
    this.turnDone = null;
    if (gen !== this.gen) return false;
    const g = this.gate;
    this.gate = null;
    this.lastFloor = g.status.floorDb;
    this.summary.ends[end] = (this.summary.ends[end] ?? 0) + 1;
    this.note(
      `your turn ${this.where(step)} · ended by ${end} after ${fmtS(g.elapsedMs / 1000)}` +
        ` · speech ${fmtS(g.status.speechMs / 1000)}${g.status.firstSpeechAt !== null ? `, first at ${fmtS(g.status.firstSpeechAt / 1000)}` : ""}` +
        ` · noise floor ${g.status.floorDb.toFixed(0)} dB`,
    );
    this.stopRecording(`${verseKey(this.verses[step.verse])} r${step.rep} · ${end}`);
    if (this.cfg.micMode === "turn") this.closeMic(this.where(step));
    this.set({ speaking: false });
    return true;
  }

  private abortTurn() {
    this.gate = null;
    this.turnDone = null;
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
    const stream = await Promise.race([
      navigator.mediaDevices.getUserMedia({ audio }),
      sleep(MIC_OPEN_TIMEOUT_MS).then(() => {
        throw new Error("the microphone took more than 10 s to open");
      }),
    ]);
    const openMs = performance.now() - t;
    if (gen !== this.gen) {
      stream.getTracks().forEach((tr) => tr.stop());
      this.note(`mic opened after the session moved on (${why}); released`);
      return false;
    }
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    const s = track.getSettings() as MediaTrackSettings & { sampleRate?: number; latency?: number };
    this.summary.micOpen.push(openMs);
    this.note(
      `mic open (${why}) in ${openMs.toFixed(0)} ms · "${track.label}" · ${s.sampleRate ?? "?"} Hz` +
        `${s.latency !== undefined ? ` · latency ${ms(s.latency)}` : ""} · echo cancellation ${s.echoCancellation ? "on" : "off"}`,
    );
    this.set({ micLabel: track.label || "microphone" });
    for (const type of ["mute", "unmute", "ended"]) {
      track.addEventListener(type, () => this.note(`mic track ${type}`));
    }
    if (this.ctx && this.node) {
      this.source = this.ctx.createMediaStreamSource(stream);
      this.source.connect(this.node);
    }
    this.micLiveAt = performance.now();
    this.sawFrame = false;
    this.sawSound = false;
    return true;
  }

  private closeMic(why: string) {
    if (!this.stream) return;
    this.source?.disconnect();
    this.source = null;
    this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.note(`mic released (${why})`);
    this.set({ level: -120, micLabel: null });
  }

  private onFrames(dbs: number[]) {
    const now = performance.now();
    if (!this.sawFrame) {
      this.sawFrame = true;
      const d = now - this.micLiveAt;
      this.summary.firstFrame.push(d);
      this.note(`first audio frames ${d.toFixed(0)} ms after the mic opened`);
    }
    if (!this.sawSound && dbs.some((db) => db > -100)) {
      this.sawSound = true;
      const d = now - this.micLiveAt;
      this.summary.firstSound.push(d);
      this.note(`first non-silent audio ${d.toFixed(0)} ms after the mic opened`);
    }
    const level = Math.max(...dbs);
    if (this.state.step?.turn === "reciter" && this.state.activity === "playing") this.reciterPeak = Math.max(this.reciterPeak, level);
    const g = this.gate;
    if (g && this.state.activity === "listening") {
      let st = g.status;
      for (const db of dbs) st = g.push(db);
      this.set({ level, speaking: st.speaking, floorDb: st.floorDb, speechMs: st.speechMs });
      if (st.end) this.turnDone?.(st.end);
    } else {
      this.set({ level });
    }
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
      this.note(`recording unavailable: ${e}`);
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

  /** The whole log as text, for pasting into a chat. */
  report(): string {
    const s = this.summary;
    const stat = (name: string, xs: number[]) => (xs.length ? `${name}: median ${median(xs).toFixed(0)} ms, max ${Math.max(...xs).toFixed(0)} ms (${xs.length})` : `${name}: –`);
    return [
      ...this.header,
      "",
      "summary",
      `  ${stat("reciter starts playing after play()", s.playLatency)}`,
      `  ${stat("mic takes to open", s.micOpen)}`,
      `  ${stat("first audio after mic open", s.firstFrame)}`,
      `  ${stat("first non-silent audio after mic open", s.firstSound)}`,
      `  your turns ended by: ${Object.entries(s.ends).map(([k, v]) => `${k} ${v}`).join(", ") || "–"}`,
      `  mic heard the reciter (dB above floor): ${s.reciterHeardDb.length ? s.reciterHeardDb.map((x) => x.toFixed(0)).join(", ") : "–"}`,
      "",
      ...this.log.map((l) => `${l.t.toFixed(2).padStart(7)}  ${l.text}`),
    ].join("\n");
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ms = (s: number | undefined) => (s === undefined || !Number.isFinite(s) ? "?" : `${(s * 1000).toFixed(0)} ms`);
const fmtS = (s: number) => (Number.isFinite(s) ? `${s.toFixed(1)} s` : "?");
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
