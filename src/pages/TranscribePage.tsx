import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import VerseMarker from "@/components/page/VerseMarker";
import { fetchQuranPages, fetchSurahs } from "@/lib/data";
import { useVoice } from "@/recitation/session/lazy";
import type { Paragraph, RawLine, VoiceStats } from "@/recitation/session/voice";
import { wordLookup, type WordLookup } from "@/recitation/session/words";
import { getVoiceSupport } from "@/recitation/support";
import type { SurahMeta } from "@/types";

/**
 * The live transcript (spec §8.1–8.2). With model B, it shows the mushaf words the reciter's voice was matched
 * to; the raw sounds are one tap away ("Show sounds"). Also: where you are (tap to open the mushaf there),
 * candidate places while that is still unclear, and a Details panel with the speed and lag numbers.
 */

const NO_SPEECH_MS = 3000;

const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (x: number, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "–");

/** Finished paragraphs never change, so they never re-render. */
const ParagraphView = memo(function ParagraphView({ p, words }: { p: Paragraph; words: WordLookup }) {
  const ayah = p.ayahEnd ? Number(p.ayahEnd.split(":")[1]) : null;
  return (
    <p dir="rtl" lang="ar" className="font-arabic text-2xl leading-loose text-ink">
      {p.items.map((it, i) => (
        <span key={i} className={it.status === "repeat" ? "text-muted" : undefined}>
          {words.text(it.key)}{" "}
        </span>
      ))}
      {ayah !== null && <VerseMarker ayahNumber={ayah} />}
    </p>
  );
});

const RawView = memo(function RawView({ line, live }: { line: RawLine; live: boolean }) {
  return (
    <p dir="rtl" lang="ar" className={`font-arabic text-xl leading-loose ${live ? "text-ink-soft" : "text-muted"}`}>
      {line.text}
    </p>
  );
});

function place(key: string, surahs: SurahMeta[] | undefined, words: WordLookup | null) {
  const [s, a] = key.split(":").map(Number);
  const name = surahs?.find((x) => x.index === s)?.tname ?? `Surah ${s}`;
  const page = words?.page(key);
  return { s, a, label: `${name} ${s}:${a}${page ? ` · page ${page}` : ""}` };
}

export default function TranscribePage() {
  const support = getVoiceSupport();
  const debug = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug");
  const { session, state } = useVoice(support.supported);
  const { data: pages } = useQuery({ queryKey: ["quran-pages"], queryFn: fetchQuranPages });
  const { data: surahs } = useQuery({ queryKey: ["surahs"], queryFn: fetchSurahs });
  const words = useMemo(() => (pages ? wordLookup(pages) : null), [pages]);
  const [showSounds, setShowSounds] = useState(false);
  const [showDetails, setShowDetails] = useState(debug);
  const [memory, setMemory] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const scroller = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);

  const phase = state?.phase ?? "checking";
  const listening = phase === "listening";

  useEffect(() => {
    if (!listening) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [listening]);

  useEffect(() => {
    if (!debug || !session) return;
    const w = window as unknown as Record<string, unknown>;
    w.__itqanVoice = session;
    w.__itqanUnitIds = () => session.getState().raw.flatMap((l) => l.units.map((u) => u.id));
  }, [debug, session]);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [state?.paragraphs, state?.raw, showSounds, pinned]);

  if (!support.supported) {
    return (
      <div className="max-w-xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold text-ink mb-2">Transcribe</h1>
        <p className="text-sm text-muted">Voice features need a browser with {support.missing.join(", ")}.</p>
      </div>
    );
  }

  const st = state;
  const s: VoiceStats | null = session?.stats ?? null;
  void st?.statsVersion;

  const status = (() => {
    if (st?.message) return st.message;
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
        if (st?.behind) return "Can't keep up on this device";
        if (!st?.speaking && now - (st?.quietSince ?? now) > NO_SPEECH_MS) return "No speech";
        return st?.tracking ? "Following" : "Listening… recite a few words so I can find the place";
    }
  })();

  const here = st?.last ? place(st.last, surahs, words) : null;
  const paragraphs = st?.paragraphs ?? [];
  const raw = st?.raw ?? [];
  const copy = () => {
    if (!words) return;
    const text = paragraphs.map((p) => p.items.map((it) => words.text(it.key)).join(" ") + (p.ayahEnd ? ` (${p.ayahEnd.split(":")[1]})` : "")).join(" ");
    void navigator.clipboard?.writeText(text);
  };

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
              onClick={() => (listening ? void session?.stop() : void session?.start())}
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
                <div className="h-full bg-primary transition-[width] duration-100" style={{ width: `${Math.min(100, Math.sqrt(st?.level ?? 0) * 250)}%` }} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 min-h-[1.75rem]" aria-live="polite">
            {here && (
              <Link
                href={`/read?surah=${here.s}&ayah=${here.a}`}
                className="px-3 py-1 rounded-full text-xs font-semibold bg-primary-soft text-primary hover:underline"
                data-testid="location"
              >
                {here.label}
              </Link>
            )}
            {!st?.tracking && (st?.candidates.length ?? 0) > 0 && (
              <>
                <span className="text-xs text-faint">Maybe:</span>
                {st!.candidates.map((c) => {
                  const pl = place(c.key, surahs, words);
                  return (
                    <Link key={c.key} href={`/read?surah=${pl.s}&ayah=${pl.a}`} className="px-2 py-0.5 rounded-full text-xs border border-edge text-muted hover:text-ink">
                      {pl.label}
                    </Link>
                  );
                })}
              </>
            )}
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
              {showSounds ? (
                raw.length ? (
                  raw.map((l, i) => <RawView key={i} line={l} live={i === raw.length - 1 && listening} />)
                ) : (
                  <p className="text-sm text-faint">The sounds the model hears appear here.</p>
                )
              ) : paragraphs.length === 0 && !(listening && st?.pendingLetters) ? (
                <p className="text-sm text-faint">Recite, and the words appear here once they're matched to the Qur'an.</p>
              ) : (
                <>
                  {words && paragraphs.map((p) => <ParagraphView key={p.id} p={p} words={words} />)}
                  {listening && !st?.tracking && (st?.pendingLetters ?? 0) > 0 && (
                    <p className="text-2xl text-faint animate-pulse" aria-hidden>
                      …
                    </p>
                  )}
                </>
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
            <button onClick={copy} disabled={!paragraphs.length} className="font-medium text-muted hover:text-ink disabled:opacity-40">
              Copy text
            </button>
            <button onClick={() => session?.clear()} disabled={(!paragraphs.length && !raw.length) || listening} className="font-medium text-muted hover:text-ink disabled:opacity-40">
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
                  if (f) void session?.transcribeFile(f);
                }}
              />
            </label>
            <button onClick={() => setShowSounds((v) => !v)} className="font-medium text-muted hover:text-ink">
              {showSounds ? "Show words" : "Show sounds"}
            </button>
            <button onClick={() => setShowDetails((v) => !v)} className="ml-auto font-medium text-muted hover:text-ink">
              {showDetails ? "Hide details" : "Details"}
            </button>
          </div>

          {showDetails && s && (
            <div className="bg-card2 rounded-lg p-3 text-xs text-ink-soft font-mono grid grid-cols-2 gap-x-4 gap-y-1" data-testid="asr-details">
              <span>model</span>
              <span>
                {st?.loaded?.packId ?? "?"} · {st?.loaded?.threads ?? "?"} threads · loaded in {fmt(st?.loaded?.loadMs ?? NaN)} ms
              </span>
              <span>Quran index</span>
              <span>{st?.engineReady ? `ready in ${fmt(s.engineLoadMs)} ms` : "loading…"}</span>
              <span>steps</span>
              <span>
                {s.steps} · dropped {s.gaps}
              </span>
              <span>step time p50 / p95</span>
              <span>
                {fmt(pct(s.infer, 50))} / {fmt(pct(s.infer, 95))} ms
              </span>
              <span>real-time factor p95</span>
              <span data-testid="rtf-p95">{fmt(pct(s.infer, 95) / s.stepAudioMs, 2)}</span>
              <span title="from the end of a sound to it showing (spec target 1500 / 2000 ms)">sound → screen p50 / p95</span>
              <span data-testid="latency">
                {fmt(pct(s.unitLatency, 50))} / {fmt(pct(s.unitLatency, 95))} ms
              </span>
              <span title="from the end of a sound to the cursor moving (spec: about 2 s or less)">sound → cursor p50 / p95</span>
              <span data-testid="cursor-lag">
                {fmt(pct(s.cursorLag, 50))} / {fmt(pct(s.cursorLag, 95))} ms
              </span>
              <span>follow engine per step p95</span>
              <span>{fmt(pct(s.engineMs, 95), 1)} ms</span>
              <span>audio clock drift</span>
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
