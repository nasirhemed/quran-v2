import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { selectedPack } from "@/recitation/asr/modelPack";
import { ModelStore, OpfsFileStore } from "@/recitation/asr/modelStore";
import type { ChunkEvent, SourceEvents } from "@/recitation/sources/RecognizerSource";
import { BrowserSource, type Loaded } from "@/recitation/sources/BrowserSource";
import { getVoiceSupport } from "@/recitation/support";

/**
 * The raw live transcript (spec §8.1, M3): what model B hears, as phonemes, with no Quran matching yet (M4).
 * A new line starts after a pause. "Details" shows the speed and latency numbers M3 is judged on.
 */

type Phase = "checking" | "no-model" | "loading" | "ready" | "listening" | "stopping" | "error";

const LINE_GAP_FRAMES = 15; // 0.6 s without a new unit starts a new line
const NO_SPEECH_MS = 3000;

interface Line {
  units: { id: number; frame: number }[];
  text: string;
}

/** Finished lines never change, so they never re-render: a long session costs the same per step as a short one. */
const LineView = memo(function LineView({ text, live }: { text: string; live: boolean }) {
  return (
    <p dir="rtl" lang="ar" className={`font-arabic text-2xl leading-loose ${live ? "text-ink-soft" : "text-ink"}`}>
      {text}
    </p>
  );
});

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "–");

export default function TranscribePage() {
  const support = getVoiceSupport();
  const debug = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug");
  const pack = useMemo(() => selectedPack(), []);
  const source = useRef<BrowserSource | null>(null);
  const [phase, setPhase] = useState<Phase>("checking");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const [quietSince, setQuietSince] = useState(0);
  const [behind, setBehind] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [showDetails, setShowDetails] = useState(debug);
  const stats = useRef({ infer: [] as number[], latency: [] as number[], unitLatency: [] as number[], drift: 0, backlogMax: 0, steps: 0, gaps: 0, lastChunk: -1, stepAudioMs: 480 });
  const [statsTick, setStatsTick] = useState(0);
  const [memory, setMemory] = useState<string | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  // Load the model once.
  useEffect(() => {
    if (!support.supported) return;
    let cancelled = false;
    (async () => {
      const ready = (await new ModelStore(new OpfsFileStore()).status(pack)).state === "ready";
      if (cancelled) return;
      if (!ready) return setPhase("no-model");
      setPhase("loading");
      const src = new BrowserSource();
      source.current = src;
      const info = await src.load(pack, 2);
      if (cancelled) return;
      if (!info) return setPhase("no-model");
      setLoaded(info);
      setPhase("ready");
    })().catch((e) => {
      setMessage(String(e instanceof Error ? e.message : e));
      setPhase("error");
    });
    return () => {
      cancelled = true;
      source.current?.dispose();
      source.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Wire events.
  useEffect(() => {
    const src = source.current;
    if (!src || !loaded) return;
    const offs = [
      src.on("chunk", (c: ChunkEvent) => {
        const s = stats.current;
        const arrival = performance.timeOrigin + performance.now();
        if (s.lastChunk >= 0 && c.chunk !== s.lastChunk + 1) s.gaps++;
        s.lastChunk = c.chunk;
        s.steps++;
        if (c.captureAtMs < c.emittedAtMs) s.latency.push(arrival - c.captureAtMs);
        if (c.units.length) {
          const sym = loaded.symbols;
          setLines((prev) => {
            // copy only the line that changes; the others keep their identity (and skip re-rendering)
            const next = prev.slice();
            for (const u of c.units) {
              const last = next[next.length - 1];
              const lastFrame = last?.units[last.units.length - 1]?.frame;
              if (!last || lastFrame === undefined || u.frame - lastFrame > LINE_GAP_FRAMES) next.push({ units: [u], text: sym[u.id] ?? "" });
              else next[next.length - 1] = { units: [...last.units, u], text: last.text + (sym[u.id] ?? "") };
            }
            return next;
          });
        }
        setStatsTick((t) => t + 1);
      }),
      src.onStep((st) => {
        const s = stats.current;
        s.infer.push(st.inferMs);
        s.stepAudioMs = st.stepAudioMs;
        s.backlogMax = Math.max(s.backlogMax, st.backlogMs);
        s.drift = st.clockDriftMs;
        const arrival = performance.timeOrigin + performance.now();
        for (const t of st.unitCaptureAtMs) s.unitLatency.push(arrival - t);
      }),
      src.on("level", (e) => setLevel(e.rms)),
      src.on("vad", (e: SourceEvents["vad"]) => {
        setSpeaking(e.speech);
        if (!e.speech) setQuietSince(Date.now());
      }),
      src.on("state", (e) => setBehind(e.state === "behind")),
      src.on("error", (e) => {
        if (e.code === "model_missing") return;
        setMessage(e.message);
        if (e.code.startsWith("mic")) setPhase("ready");
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [loaded]);

  // Clock for "No speech".
  useEffect(() => {
    if (phase !== "listening") return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [phase]);

  const stop = useCallback(async () => {
    const src = source.current;
    if (!src) return;
    setPhase("stopping");
    await src.stop();
    await wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
    setLevel(0);
    setPhase("ready");
  }, []);

  // Stop when the page is hidden (spec §10.6).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && phase === "listening") void stop();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [phase, stop]);

  const resetStats = () => {
    stats.current = { infer: [], latency: [], unitLatency: [], drift: 0, backlogMax: 0, steps: 0, gaps: 0, lastChunk: -1, stepAudioMs: 480 };
    setStatsTick((t) => t + 1);
  };

  const start = async () => {
    const src = source.current;
    if (!src) return;
    setMessage(null);
    resetStats();
    setSpeaking(false);
    setQuietSince(Date.now());
    try {
      const pending = src.start(); // creates the AudioContext inside this tap
      setPhase("listening");
      await pending;
      wakeLock.current = await navigator.wakeLock?.request("screen").catch(() => null);
    } catch {
      setPhase("ready");
    }
  };

  const transcribeFile = async (file: File) => {
    const src = source.current;
    if (!src) return;
    setMessage(null);
    resetStats();
    setPhase("listening");
    try {
      // decoded straight to 16 kHz by the browser; the worker's resampler then passes it through unchanged
      const ctx = new OfflineAudioContext(1, 1, 16000);
      const audio = await ctx.decodeAudioData(await file.arrayBuffer());
      const mono = new Float32Array(audio.length);
      for (let c = 0; c < audio.numberOfChannels; c++) {
        const ch = audio.getChannelData(c);
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
      }
      setPhase("stopping");
      await src.transcribe(mono, audio.sampleRate);
    } catch (e) {
      setMessage(`Couldn't read that file: ${e instanceof Error ? e.message : e}`);
    }
    setPhase("ready");
  };

  // Tests read the unit ids through this (debug only), instead of serialising them into the DOM every step.
  useEffect(() => {
    if (!debug) return;
    (window as unknown as { __itqanUnitIds?: () => number[] }).__itqanUnitIds = () => lines.flatMap((l) => l.units.map((u) => u.id));
  }, [debug, lines]);

  // Auto-scroll unless the reader scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [lines, pinned]);

  const copy = () => navigator.clipboard?.writeText(lines.map((l) => l.text).join("\n"));

  const s = stats.current;
  void statsTick;
  // percentiles sort the whole session's samples: only when the panel is open
  const inferP50 = showDetails ? pct(s.infer, 50) : NaN;
  const inferP95 = showDetails ? pct(s.infer, 95) : NaN;

  const status = (() => {
    if (message) return message;
    switch (phase) {
      case "checking":
        return "…";
      case "no-model":
        return "Model not downloaded";
      case "loading":
        return "Loading the speech model…";
      case "ready":
        return "Tap the microphone and recite";
      case "stopping":
        return "Finishing…";
      case "error":
        return "Something went wrong";
      case "listening":
        if (behind) return "Can't keep up on this device";
        return !speaking && now - quietSince > NO_SPEECH_MS ? "No speech" : "Listening";
    }
  })();

  if (!support.supported) {
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold text-ink mb-2">Transcribe</h1>
        <p className="text-sm text-muted">Voice features need a browser with {support.missing.join(", ")}.</p>
      </div>
    );
  }

  const listening = phase === "listening";
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">Transcribe</h1>
        <Link href="/voice" className="text-xs font-medium text-muted hover:text-ink">
          Voice settings
        </Link>
      </div>

      {phase === "no-model" ? (
        <div className="bg-card border border-edge rounded-lg p-4 text-sm text-muted">
          Download the speech model first (once; it then works offline).{" "}
          <Link href="/voice" className="font-semibold text-primary hover:underline">
            Go to voice settings
          </Link>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <button
              onClick={() => (listening ? void stop() : void start())}
              disabled={phase !== "ready" && phase !== "listening"}
              aria-label={listening ? "Stop" : "Start listening"}
              className={`shrink-0 w-16 h-16 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 ${
                listening ? "bg-red-500 text-white" : "bg-primary text-on-primary"
              }`}
            >
              {listening ? (
                <span className="w-5 h-5 rounded-sm bg-white" />
              ) : (
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm6-3a6 6 0 01-12 0m6 6v3m-3 0h6" />
                </svg>
              )}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink" role="status">
                {status}
              </p>
              <div className="mt-2 h-1.5 rounded-full bg-card2 overflow-hidden" aria-hidden>
                <div className="h-full bg-primary transition-[width] duration-100" style={{ width: `${Math.min(100, Math.sqrt(level) * 250)}%` }} />
              </div>
            </div>
          </div>

          <div className="relative">
            <div
              ref={scroller}
              onScroll={(e) => {
                const el = e.currentTarget;
                setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
              }}
              className="bg-card border border-edge rounded-lg p-4 h-[45vh] overflow-y-auto"
              aria-live="off"
            >
              {lines.length === 0 ? (
                <p className="text-sm text-faint">What the model hears appears here, as sounds (phonemes). Matching it to the Qur'an text comes next.</p>
              ) : (
                lines.map((l, i) => <LineView key={i} text={l.text} live={i === lines.length - 1 && listening} />)
              )}
            </div>
            {!pinned && (
              <button
                onClick={() => setPinned(true)}
                className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold bg-primary text-on-primary shadow"
              >
                Jump to latest
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button onClick={copy} disabled={!lines.length} className="font-medium text-muted hover:text-ink disabled:opacity-40">
              Copy text
            </button>
            <button onClick={() => setLines([])} disabled={!lines.length || listening} className="font-medium text-muted hover:text-ink disabled:opacity-40">
              Clear
            </button>
            <label className={`font-medium text-muted hover:text-ink cursor-pointer ${phase !== "ready" ? "opacity-40 pointer-events-none" : ""}`}>
              Transcribe an audio file…
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void transcribeFile(f);
                }}
              />
            </label>
            <button onClick={() => setShowDetails((v) => !v)} className="ml-auto font-medium text-muted hover:text-ink">
              {showDetails ? "Hide details" : "Details"}
            </button>
          </div>

          {showDetails && (
            <div className="bg-card2 rounded-lg p-3 text-xs text-ink-soft font-mono grid grid-cols-2 gap-x-4 gap-y-1" data-testid="asr-details">
              <span>model</span>
              <span>
                {pack.id} · {loaded?.threads ?? "?"} threads · loaded in {fmt(loaded?.loadMs ?? NaN)} ms
              </span>
              <span>steps</span>
              <span>
                {s.steps} · dropped {s.gaps}
              </span>
              <span>step time p50 / p95</span>
              <span>
                {fmt(inferP50)} / {fmt(inferP95)} ms
              </span>
              <span>real-time factor p95</span>
              <span data-testid="rtf-p95">{fmt(inferP95 / s.stepAudioMs, 2)}</span>
              <span title="from the end of a sound to it showing here (spec target 1500 / 2000 ms)">sound → screen p50 / p95</span>
              <span data-testid="latency">
                {fmt(pct(s.unitLatency, 50))} / {fmt(pct(s.unitLatency, 95))} ms
              </span>
              <span title="processing after a step's audio window closes">step processing p50 / p95</span>
              <span>
                {fmt(pct(s.latency, 50))} / {fmt(pct(s.latency, 95))} ms
              </span>
              <span title="audio clock vs system clock, corrected for">audio clock drift</span>
              <span>{fmt(s.drift)} ms</span>
              <span>max backlog</span>
              <span>{fmt(s.backlogMax)} ms</span>
              <span>memory</span>
              <span>
                {memory ?? (
                  <button
                    className="underline"
                    onClick={async () => {
                      const m = (performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }).measureUserAgentSpecificMemory;
                      if (!m) return setMemory("not available");
                      setMemory("measuring (up to a minute)…");
                      const r = await m.call(performance);
                      setMemory(`${(r.bytes / 1e6).toFixed(0)} MB`);
                    }}
                  >
                    measure
                  </button>
                )}
              </span>
            </div>
          )}
        </>
      )}

      <p className="text-xs text-muted border-t border-edge pt-3">
        Everything is processed on this device; audio is never stored or sent. The output comes from a speech model and
        can be wrong. It is a study aid, not a religious ruling.
      </p>
    </div>
  );
}
