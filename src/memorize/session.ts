/**
 * A Memorize session: for each verse, the reciter plays it (listen ×X), then you recite it and the reciter plays it
 * again in turn, N times, then the next verse. Pause/resume, again, next; the car's media buttons work too.
 *
 * The mic opens once, at Start, and stays open (the car test found that most reliable with Bluetooth). Your turn
 * ends when the speech model hears you reach the verse's last word (Recognizer + ModelTurn): quiet only counts
 * once you have started, a pause to remember shows the next words as a hint, and only a long quiet moves on.
 * Without the model (not downloaded, or this browser can't run it), a stretch of quiet ends your turn (TurnGate).
 *
 * Everything that happens is kept in a short log (copy it from the summary screen) for reporting problems.
 */
import workletUrl from "./level.worklet.ts?worker&url";
import { Recognizer } from "./recognizer";
import {
  again,
  gateOptions,
  ModelTurn,
  modelTurnOptions,
  nextStep,
  NOT_A_ROOM_DB,
  skipVerse,
  TurnGate,
  verseAudioUrl,
  verseKey,
  verseStart,
  type GateEnd,
  type ModelTurnEnd,
  type Plan,
  type Reciter,
  type Step,
  type Verse,
} from "@/lib/memorize";

export interface MemorizeConfig {
  /** times you recite each verse */
  reps: number;
  /** times you listen to each verse first */
  listen: number;
  /** the reciter's playback speed (pitch kept) */
  speed: number;
  /** end your turn with the speech model when it is available */
  useModel: boolean;
  /** with the model: show the next words after this long without progress; 0 = no hints */
  hintAfterMs: number;
  /** with the model: this much quiet, once you have started, moves on; 0 = never */
  giveUpMs: number;
  /** without the model: this much quiet ends your turn */
  endSilenceMs: number;
  /** a short beep when it's your turn */
  cue: boolean;
}

export type Phase = "idle" | "starting" | "running" | "paused" | "done" | "error";
export type Activity = "loading" | "playing" | "listening" | null;
export type ModelState = "off" | "loading" | "ready" | "failed";

export interface MemorizeState {
  phase: Phase;
  step: Step | null;
  activity: Activity;
  /** mic level (dBFS) and whether it hears a voice */
  level: number;
  speaking: boolean;
  model: ModelState;
  /** words of this turn's verse the model heard ("s:a:w") */
  heard: string[];
  /** the furthest word shown as a hint (1-based; 0 = none) */
  hintTo: number;
  verseDone: boolean;
  speed: number;
  message: string | null;
  /** per-session results, for the summary */
  turns: number;
  /** turns the speech model listened to, and how many of those reached the verse's end */
  modelTurns: number;
  completed: number;
  hints: number;
}

type TurnEnd = GateEnd | ModelTurnEnd | "tap" | "no-frames" | "aborted";

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
const NO_FRAMES_MS = 2500;
const FETCH_RETRY_MS = [1000, 3000, 8000];
const PREFETCH = 4;
/** How long your first turn waits for the speech model to finish loading before it falls back to quiet. */
const MODEL_WAIT_MS = 10000;

export class MemorizeSession {
  readonly log: { t: number; text: string }[] = [];
  header: string[] = [];
  state: MemorizeState = {
    phase: "idle",
    step: null,
    activity: null,
    level: -120,
    speaking: false,
    model: "off",
    heard: [],
    hintTo: 0,
    verseDone: false,
    speed: 1,
    message: null,
    turns: 0,
    modelTurns: 0,
    completed: 0,
    hints: 0,
  };

  private listeners = new Set<() => void>();
  private cfg!: MemorizeConfig;
  private plan!: Plan;
  private verses: Verse[] = [];
  private reciter!: Reciter;
  private wordCount: (ayah: string) => number = () => NaN;
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
  private modelTurn: ModelTurn | null = null;
  /** ends the turn in progress (and clears its timers) */
  private endTurn: ((e: TurnEnd) => void) | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private lastFrameAt = 0;
  private pausedByMute = false;
  private lastNoise = NaN;
  private cleanup: (() => void)[] = [];
  /** the speech model, loaded on the first Start that wants it and kept for the page's life */
  private recognizer: Recognizer | null = null;
  private recognizerLoad: Promise<boolean> | null = null;
  private loadingRec: Recognizer | null = null;
  private disposed = false;
  private waitedForModel = false;
  /** the verse being listened for with the model */
  private listeningFor: string | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<MemorizeState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private note(text: string) {
    this.log.push({ t: (performance.now() - this.t0) / 1000, text });
  }

  private where(step = this.state.step) {
    return step ? `${verseKey(this.verses[step.verse])} ${step.turn} ${step.rep}` : "";
  }

  /** Starts the session. Call from a tap: the audio context, the player and the wake lock are unlocked inside it. */
  async start(cfg: MemorizeConfig, verses: Verse[], reciter: Reciter, wordCount: (ayah: string) => number) {
    if (this.state.phase === "running" || this.state.phase === "starting" || this.state.phase === "paused" || !verses.length) return;
    this.log.length = 0;
    this.reciterMs.clear();
    this.lastNoise = NaN;
    this.pausedByMute = false;
    this.waitedForModel = false;
    this.cfg = cfg;
    this.plan = { verses: verses.length, reps: cfg.reps, listen: cfg.listen };
    this.verses = verses;
    this.reciter = reciter;
    this.wordCount = wordCount;
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

    const first = verseStart(0, this.plan);
    this.set({ phase: "starting", step: first, activity: "loading", message: null, heard: [], hintTo: 0, verseDone: false, speed: cfg.speed, turns: 0, modelTurns: 0, completed: 0, hints: 0 });
    this.header = [
      `Itqan memorize · ${new Date().toISOString()}`,
      `browser: ${navigator.userAgent}`,
      `plan: ${verseKey(verses[0])}–${verseKey(verses[verses.length - 1])} (${verses.length} verses) · listen ×${cfg.listen} · recite ×${cfg.reps} · ${reciter.name} at ${cfg.speed}×`,
      `turn end: ${cfg.useModel ? `speech model · hints ${cfg.hintAfterMs ? `after ${cfg.hintAfterMs} ms` : "off"} · give up after ${cfg.giveUpMs ? `${cfg.giveUpMs} ms quiet` : "never"}` : `${cfg.endSilenceMs} ms quiet`}`,
    ];
    this.watch(audio, ctx);
    if (cfg.useModel) void this.loadModel();
    else this.set({ model: "off" });
    void wake?.then(
      (w) => this.holdWakeLock(w),
      (e) => this.note(`wake lock refused: ${errorText(e)}`),
    );

    try {
      await ctx.audioWorklet.addModule(workletUrl);
      if (gen !== this.gen) return;
      const node = new AudioWorkletNode(ctx, "itqan-memorize-level", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
      const mute = ctx.createGain();
      mute.gain.value = 0; // the node must reach the destination to run; nothing is played
      node.connect(mute).connect(ctx.destination);
      node.port.onmessage = (e: MessageEvent<number[]>) => this.onFrames(e.data);
      this.node = node;
      // asked for now, not in the middle of a drive; it stays open for the whole session
      if (!(await this.openMic(gen))) return;
    } catch (e) {
      if (gen === this.gen) this.fail(e);
      return;
    }
    this.mediaSession(true);
    if (gen !== this.gen) return;
    this.set({ phase: "running" });
    void this.run(first, gen);
  }

  /** Pause: the verse (or your turn) starts again from the beginning on resume. */
  pause(why = "tap") {
    if (this.state.phase !== "running") return;
    this.gen++;
    this.note(`pause (${why}) at ${this.where()}`);
    this.audio?.pause();
    this.abortTurn();
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

  /** Ends your turn now, or skips the rest of the reciter's verse. */
  next(why = "tap") {
    const step = this.state.step;
    if (this.state.phase !== "running" || !step) return;
    if (this.state.activity === "listening") return this.endTurn?.("tap");
    if (step.turn === "you") return;
    this.jump(nextStep(step, this.plan), `next (${why})`);
  }

  /** Hear this verse again, then your turn. */
  again(why = "tap") {
    const step = this.state.step;
    if (step) this.jump(again(step), `again (${why})`);
  }

  /** Jumps to the next verse. */
  nextVerse(why = "tap") {
    const step = this.state.step;
    if (step) this.jump(skipVerse(step, this.plan), `next verse (${why})`);
  }

  private jump(to: Step | null, what: string) {
    if (this.state.phase !== "running" && this.state.phase !== "paused") return;
    this.gen++;
    this.audio?.pause();
    this.abortTurn();
    this.note(`${what} from ${this.where()}`);
    if (!to) return this.finish();
    this.set({ phase: "running" });
    void this.run(to, ++this.gen);
  }

  /** The reciter's speed, now and for the rest of the session. */
  setSpeed(speed: number) {
    if (this.cfg) this.cfg.speed = speed;
    if (this.audio) {
      this.audio.defaultPlaybackRate = speed;
      this.audio.playbackRate = speed;
    }
    this.set({ speed });
  }

  stop() {
    if (this.state.phase === "idle" || this.state.phase === "done" || this.state.phase === "error") return;
    this.note("stop");
    this.finish("idle");
  }

  /** Stops everything and frees the speech model (when the page closes). */
  dispose() {
    this.disposed = true;
    this.stop();
    this.recognizer?.dispose();
    this.loadingRec?.dispose();
    this.recognizer = null;
    this.loadingRec = null;
    this.recognizerLoad = null;
  }

  /** This session's log as text, for reporting a problem. */
  report(): string {
    const s = this.state;
    return [
      ...this.header,
      `result: ${s.turns} turns${s.modelTurns ? `, ${s.completed} of ${s.modelTurns} heard to the end, ${s.hints} hints` : ""}`,
      "",
      ...this.log.map((l) => `${l.t.toFixed(2).padStart(7)}  ${l.text}`),
    ].join("\n");
  }

  private finish(phase: Phase = "done") {
    this.gen++;
    this.audio?.pause();
    this.abortTurn();
    this.closeMic();
    if (phase === "done") this.note("done: every verse recited");
    this.teardown();
    this.set({ phase, activity: null, speaking: false, level: -120 });
  }

  private fail(e: unknown) {
    const message = errorText(e);
    this.note(`error · ${message}`);
    this.gen++;
    this.audio?.pause();
    this.abortTurn();
    this.closeMic();
    this.teardown();
    this.set({ phase: "error", activity: null, message });
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

  private holdWakeLock(w: WakeLockSentinel) {
    if (this.state.phase !== "running" && this.state.phase !== "starting" && this.state.phase !== "paused") {
      void w.release().catch(() => undefined);
      return;
    }
    this.wakeLock = w;
  }

  /** Watches the browser and the devices while the session runs. */
  private watch(audio: HTMLAudioElement, ctx: AudioContext) {
    const on = <T extends EventTarget>(target: T, type: string, fn: (e: Event) => void) => {
      target.addEventListener(type, fn);
      this.cleanup.push(() => target.removeEventListener(type, fn));
    };
    on(audio, "error", () => {
      if (!audio.src.startsWith("data:")) this.note(`player error${audio.error ? ` (${audio.error.code} ${audio.error.message})` : ""}`);
    });
    // Chrome on Android suspends the audio context when the reciter starts playing (the car test lost every first
    // turn to it): wake it straight away
    on(ctx, "statechange", () => {
      this.note(`audio context ${ctx.state}`);
      if (ctx.state === "suspended" && (this.state.phase === "running" || this.state.phase === "starting")) void ctx.resume();
    });
    on(navigator.mediaDevices, "devicechange", () => this.note("devices changed"));
    on(document, "visibilitychange", () => {
      this.note(`page ${document.visibilityState}`);
      if (document.visibilityState === "visible" && (this.state.phase === "running" || this.state.phase === "paused")) {
        void navigator.wakeLock?.request("screen").then(
          (w) => this.holdWakeLock(w),
          () => undefined,
        );
      }
    });
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
    // The car's (or headphones') buttons. Play and pause are one toggle: the car decides which to send from the
    // player's state, which says "paused" during your turn even though the session is running.
    const handler = (action: string, fn: () => void) => () => {
      this.note(`car button: ${action}`);
      fn();
    };
    const toggle = () => (this.state.phase === "paused" ? this.resume("car button") : this.pause("car button"));
    set("play", on ? handler("play", toggle) : null);
    set("pause", on ? handler("pause", toggle) : null);
    set("stop", on ? handler("stop", () => this.pause("car button")) : null);
    set("nexttrack", on ? handler("next", () => this.next("car button")) : null);
    set("previoustrack", on ? handler("previous", () => this.again("car button")) : null);
    ms.playbackState = on ? "playing" : "none";
    if (!on) ms.metadata = null;
  }

  private showStep(step: Step) {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = "playing";
    if (typeof MediaMetadata === "undefined") return;
    const label = step.turn === "you" ? `your turn ${step.rep} of ${this.cfg.reps}` : step.turn === "listen" ? `listen ${step.rep} of ${this.cfg.listen}` : "listen";
    navigator.mediaSession.metadata = new MediaMetadata({ title: `${verseKey(this.verses[step.verse])} · ${label}`, artist: this.reciter.name, album: "Itqān · Memorize" });
  }

  /** The verse's audio as an object URL, fetched once per session. */
  private verseAudio(i: number): Promise<string> {
    const url = verseAudioUrl(this.reciter, this.verses[i]);
    let p = this.blobs.get(url);
    if (!p) {
      p = fetch(url, { mode: "cors" }).then(async (r) => {
        if (!r.ok) throw new Error(`${r.status} for ${url}`);
        return URL.createObjectURL(await r.blob());
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
        this.note(`couldn't fetch ${verseKey(this.verses[i])} (${errorText(e)}); trying again`);
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
        const ok = step.turn === "you" ? await this.yourTurn(step, gen) : await this.reciterTurn(step, gen);
        if (!ok || gen !== this.gen) return;
      } catch (e) {
        if (gen === this.gen) this.fail(e);
        return;
      }
      step = nextStep(step, this.plan);
    }
    if (gen === this.gen && !step) this.finish();
  }

  private async reciterTurn(step: Step, gen: number): Promise<boolean> {
    const audio = this.audio!;
    this.set({ activity: "loading", speaking: false, heard: [], hintTo: 0, verseDone: false });
    for (let k = 1; k <= PREFETCH && step.verse + k < this.verses.length; k++) void this.verseAudio(step.verse + k).catch(() => undefined);
    const src = await this.verseAudioWithRetry(step.verse, gen);
    if (!src || gen !== this.gen) return false;

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
        reject(new Error(`couldn't play ${verseKey(this.verses[step.verse])}`));
      };
      const onPause = () => {
        if (audio.ended || !started) return;
        off();
        if (gen === this.gen && this.state.phase === "running") {
          this.note("player paused by the system");
          this.pause("system");
        }
        resolve("stopped");
      };
      const onPlaying = () => {
        if (gen !== this.gen || started) return;
        started = true;
        const d = audio.duration;
        if (Number.isFinite(d)) this.reciterMs.set(step.verse, (d * 1000) / this.cfg.speed);
        this.note(`reciter ${this.where(step)} · ${fmtS(d)} at ${this.cfg.speed}×`);
        if (stuck) clearTimeout(stuck);
        stuck = setTimeout(
          () => {
            off();
            if (gen !== this.gen) return resolve("stopped");
            this.note("the verse didn't finish playing; moving on");
            resolve("ended");
          },
          (Number.isFinite(d) ? (d * 1000) / this.cfg.speed : 60000) + 8000,
        );
      };
      audio.addEventListener("ended", onEnded);
      audio.addEventListener("error", onError);
      audio.addEventListener("pause", onPause);
      audio.addEventListener("playing", onPlaying);
      audio.src = src;
      // a new source resets the rate to the default one, so set both (the pitch is kept)
      audio.defaultPlaybackRate = this.cfg.speed;
      audio.playbackRate = this.cfg.speed;
      audio.preservesPitch = true;
      stuck = setTimeout(() => {
        off();
        if (gen !== this.gen) return resolve("stopped");
        reject(new Error(`the verse didn't start playing within 20 s`));
      }, 20000);
      this.set({ activity: "playing" });
      audio.play().catch((e) => {
        off();
        if (gen !== this.gen) return resolve("stopped");
        reject(e);
      });
    });
    return result === "ended" && gen === this.gen;
  }

  private async yourTurn(step: Step, gen: number): Promise<boolean> {
    // the model loads while the first verse plays; if it's still loading, wait for it a little (once per session)
    if (this.cfg.useModel && this.state.model === "loading" && this.recognizerLoad && !this.waitedForModel) {
      this.waitedForModel = true;
      this.set({ activity: "loading" });
      await Promise.race([this.recognizerLoad, sleep(MODEL_WAIT_MS)]);
      if (gen !== this.gen) return false;
    }
    const ctx = this.ctx;
    if (ctx && ctx.state !== "running") await Promise.race([ctx.resume(), sleep(1000)]);
    if (this.stream?.getAudioTracks()[0]?.readyState === "ended") this.closeMic();
    if (!this.stream && !(await this.openMic(gen))) return false;
    const stream = this.stream;
    if (!stream) throw new Error("the microphone is not open");

    const ayah = verseKey(this.verses[step.verse]);
    const words = this.wordCount(ayah);
    this.listeningFor = null;
    this.set({ heard: [], hintTo: 0, verseDone: false });
    // the model starts listening before the beep, so it hears your first word
    let withModel = this.cfg.useModel && this.state.model === "ready" && !!this.recognizer && Number.isFinite(words);
    if (this.cfg.useModel && !withModel) this.note(`speech model ${this.state.model}: this turn ends on quiet`);
    if (withModel) {
      try {
        this.listeningFor = ayah;
        await this.recognizer!.begin(stream, ayah);
      } catch (e) {
        withModel = false;
        this.listeningFor = null;
        this.recognizer?.end();
        if (gen === this.gen) this.note(`speech model couldn't listen: ${errorText(e)}; this turn ends on quiet`);
      }
      if (gen !== this.gen) {
        this.listeningFor = null;
        this.recognizer?.end();
        return false;
      }
    }
    if (this.cfg.cue) this.beep();
    // the beep travels out through the car and back in through the mic: ignore it
    const guard = this.cfg.cue && ctx ? Math.max(800, 330 + 1000 * ((ctx.baseLatency || 0) + (ctx.outputLatency || 0.3))) : 400;
    const reciterMs = this.reciterMs.get(step.verse) ?? NaN;
    const gate = new TurnGate(gateOptions(reciterMs, this.cfg.endSilenceMs, 10, guard, this.lastNoise));
    this.gate = gate;
    this.modelTurn = withModel ? new ModelTurn(modelTurnOptions(words, reciterMs, this.cfg.hintAfterMs, this.cfg.giveUpMs || Infinity)) : null;
    this.lastFrameAt = performance.now();
    this.set({ activity: "listening", speaking: false });
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
    const mt = this.modelTurn;
    this.listeningFor = null;
    this.modelTurn = null;
    this.recognizer?.end();
    if (gen !== this.gen || end === "aborted") return false;
    this.gate = null;
    const room = gate.roomDb();
    if (Number.isFinite(room)) this.lastNoise = room;
    const complete = !!mt && (end === "complete" || mt.heardTo >= words);
    this.set({
      speaking: false,
      turns: this.state.turns + 1,
      modelTurns: this.state.modelTurns + (mt ? 1 : 0),
      completed: this.state.completed + (complete ? 1 : 0),
      hints: this.state.hints + (mt?.hints ?? 0),
    });
    this.note(
      `your turn ${this.where(step)} · ${end} after ${fmtS(gate.elapsedMs / 1000)}` +
        (mt ? ` · heard to word ${mt.heardTo} of ${words}${mt.hints ? ` · ${mt.hints} hint${mt.hints > 1 ? "s" : ""}` : ""}` : ` · speech ${fmtS(gate.status.speechMs / 1000)}`),
    );
    return true;
  }

  private abortTurn() {
    this.gate = null;
    this.modelTurn = null;
    this.listeningFor = null;
    this.recognizer?.end();
    this.endTurn?.("aborted");
    this.endTurn = null;
  }

  /** Loads the speech model in the background (once per page); the reciter's first verse plays meanwhile. */
  private loadModel(): Promise<boolean> {
    if (this.recognizer) {
      this.set({ model: "ready" });
      return Promise.resolve(true);
    }
    if (this.recognizerLoad) return this.recognizerLoad;
    this.set({ model: "loading" });
    const rec = new Recognizer({
      heard: (keys) => this.onHeard(keys),
      ayahComplete: (ayah) => this.onAyahComplete(ayah),
      note: (text) => this.note(text),
    });
    this.loadingRec = rec;
    this.recognizerLoad = rec.load().then(
      () => {
        this.loadingRec = null;
        if (this.disposed) {
          rec.dispose();
          return false;
        }
        this.recognizer = rec;
        if (this.cfg?.useModel) {
          this.set({ model: "ready" });
          this.note(`speech model ready in ${rec.loadMs.toFixed(0)} ms`);
        }
        return true;
      },
      (e) => {
        this.loadingRec = null;
        rec.dispose();
        this.recognizerLoad = null;
        if (this.disposed) return false;
        this.set({ model: "failed" });
        this.note(`speech model couldn't load: ${errorText(e)}; turns end on quiet`);
        return false;
      },
    );
    return this.recognizerLoad;
  }

  private onHeard(keys: string[]) {
    const ayah = this.listeningFor;
    if (!ayah || this.state.activity !== "listening" || !this.gate) return;
    const mine = keys.filter((k) => k.startsWith(`${ayah}:`));
    if (!mine.length) return;
    const before = this.modelTurn?.heardTo ?? 0;
    for (const k of mine) this.modelTurn?.heard(Number(k.slice(ayah.length + 1)), this.gate.elapsedMs);
    const now = this.modelTurn?.heardTo ?? 0;
    if (now > before) this.note(`  heard to word ${now} at ${fmtS(this.gate.elapsedMs / 1000)}`);
    this.set({ heard: [...this.state.heard, ...mine] });
  }

  private onAyahComplete(ayah: string) {
    if (!this.listeningFor || this.state.activity !== "listening" || !this.gate) return;
    if (ayah !== this.listeningFor) return this.note(`speech model: recited to the end of ${ayah} (not ${this.listeningFor})`);
    this.note(`  verse complete at ${fmtS(this.gate.elapsedMs / 1000)}`);
    this.modelTurn?.complete(this.gate.elapsedMs);
    this.set({ verseDone: true });
  }

  /** Opens the mic; false (and the mic released again) if the session moved on while it was opening. */
  private async openMic(gen: number): Promise<boolean> {
    if (this.stream) return true;
    const req = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      giveUp = setTimeout(() => reject(new Error("the microphone didn't open within a minute")), 60000);
    });
    let stream: MediaStream;
    try {
      stream = await Promise.race([req, timeout]);
    } catch (e) {
      void req.then(
        (late) => late.getTracks().forEach((tr) => tr.stop()),
        () => undefined,
      );
      throw e;
    } finally {
      clearTimeout(giveUp);
    }
    if (gen !== this.gen) {
      stream.getTracks().forEach((tr) => tr.stop());
      return false;
    }
    this.stream = stream;
    const track = stream.getAudioTracks()[0];
    this.note(`mic: "${track.label}"`);
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
    }
    return true;
  }

  /** iOS mutes the mic while the page is hidden (screen locked): pause, and carry on when it comes back. */
  private onMute(track: MediaStreamTrack) {
    this.note("mic track muted");
    setTimeout(() => {
      if (!track.muted || track.readyState === "ended" || this.state.phase !== "running") return;
      this.pausedByMute = true;
      this.pause("mic muted by the system");
    }, 1000);
  }

  private closeMic() {
    if (!this.stream) return;
    this.source?.disconnect();
    this.source = null;
    this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  private onFrames(dbs: number[]) {
    this.lastFrameAt = performance.now();
    const level = Math.max(...dbs);
    const g = this.gate;
    if (!g || this.state.activity !== "listening") {
      if (Math.abs(level - this.state.level) > 3) this.set({ level });
      return;
    }
    let st = g.status;
    for (const db of dbs) st = g.push(db);
    const mt = this.modelTurn;
    if (mt) {
      const hint = mt.tick(g.elapsedMs, st.speaking && level > NOT_A_ROOM_DB);
      if (hint !== null) {
        this.note(`  hint: words up to ${hint} at ${fmtS(g.elapsedMs / 1000)}`);
        this.set({ hintTo: hint });
      }
      this.set({ level, speaking: st.speaking });
      if (mt.end) this.endTurn?.(mt.end);
    } else {
      this.set({ level, speaking: st.speaking });
      if (st.end) this.endTurn?.(st.end);
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
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const fmtS = (s: number) => (Number.isFinite(s) ? `${s.toFixed(1)} s` : "?");
