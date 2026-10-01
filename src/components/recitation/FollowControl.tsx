import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useVoice, voiceNow } from "@/recitation/session/lazy";
import type { Mode } from "@/recitation/session/voice";
import { wordLookup } from "@/recitation/session/words";
import { getVoiceSupport } from "@/recitation/support";
import type { QuranPage, SurahMeta } from "@/types";
// only needed after a verify run: loaded then, so the reader stays light
const VerifyResults = lazy(() => import("./VerifyResults"));

/**
 * Voice in the reader (spec §8.1, §7.6):
 * - Follow: the current-word ring on the mushaf, automatic page turns, and a strip with where you are.
 * - Verify: the same live follow-along; on Stop the whole recording is checked and a results sheet lists the
 *   confirmed mistakes, which are also marked on the mushaf.
 * The buttons sit in the navigation bar, never over the text. The voice session loads only when first used.
 */

const MicIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm6-3a6 6 0 01-12 0m6 6v3m-3 0h6" />
  </svg>
);
const CheckIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5 2a8 8 0 11-16 0 8 8 0 0116 0z" />
  </svg>
);

/** Keep `el` inside the visible band between the sticky bars and the strip; scroll only when it nears an edge. */
function keepInView(el: HTMLElement, strip: HTMLElement | null) {
  const bars = [...document.querySelectorAll<HTMLElement>("[data-sticky-top]")].map((b) => b.getBoundingClientRect().bottom);
  const top = Math.max(0, ...bars);
  const bottom = strip ? strip.getBoundingClientRect().top : window.innerHeight;
  const band = bottom - top;
  const r = el.getBoundingClientRect();
  const margin = Math.min(48, band / 6);
  if (r.top >= top + margin && r.bottom <= bottom - margin) return; // comfortably visible: don't move the page
  // put the word a quarter of the way down the band, so the lines ahead stay visible
  window.scrollBy({ top: r.top - (top + band / 4), behavior: "smooth" });
}

const MARK_CLASS = { SKIPPED: "voice-skipped", SKIPPED_AYAH: "voice-skipped", WRONG_WORD: "voice-wrong", MUTASHABIH_SLIP: "voice-slip" } as const;

export function useFollowMode({
  pages,
  surahs,
  currentPage,
  onNavigateToPage,
  onHeard,
}: {
  pages: QuranPage[] | undefined;
  surahs: SurahMeta[] | undefined;
  currentPage: number;
  onNavigateToPage: (page: number) => void;
  /** the words heard since the last call ("s:a:w"), in order: for revealing hidden words */
  onHeard?: (keys: string[]) => void;
}): { supported: boolean; following: boolean; button: ReactNode; strip: ReactNode } {
  const supported = useMemo(() => getVoiceSupport().supported, []);
  const [wanted, setWanted] = useState<Mode | null>(() => (voiceNow()?.getState().phase === "listening" ? voiceNow()!.getState().mode : null));
  const { session, state } = useVoice(wanted !== null || !!voiceNow());
  const words = useMemo(() => (pages ? wordLookup(pages) : null), [pages]);
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(Date.now());
  const startedFor = useRef(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const phase = state?.phase;
  const mode = state?.mode ?? "follow";
  const listening = phase === "listening" || phase === "stopping";
  const verifying = state?.verify.status === "checking";
  const results = state?.verify.status === "done" || state?.verify.status === "error" ? state.verify : null;

  // First tap loads the session; start listening as soon as it's ready.
  useEffect(() => {
    if (wanted && session && phase === "ready" && !startedFor.current) {
      startedFor.current = true;
      void session.start(wanted);
    }
  }, [wanted, session, phase]);

  // Clock for the verify time limit.
  useEffect(() => {
    if (!(listening && mode === "verify")) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [listening, mode]);

  // Ring the word just recited, straight on the DOM (no page re-render per step), and keep it in view.
  const last = listening ? state?.last ?? null : null;
  useEffect(() => {
    if (!last) return;
    const el = document.querySelector<HTMLElement>(`[data-w="${last}"]`);
    if (!el) return;
    el.classList.add("voice-current");
    keepInView(el, stripRef.current);
    return () => el.classList.remove("voice-current");
  }, [last, currentPage]);

  // Report the words heard since last time. Paragraphs only grow (ids rise, items are appended), so this reads
  // just the new ones; whatever was heard before the reader opened is not reported.
  const paragraphs = state?.paragraphs;
  const seen = useRef<{ id: number; n: number } | null>(null);
  const onHeardRef = useRef(onHeard);
  onHeardRef.current = onHeard;
  useEffect(() => {
    if (!paragraphs) return;
    const end = paragraphs[paragraphs.length - 1];
    const prev = seen.current;
    seen.current = end ? { id: end.id, n: end.items.length } : { id: 0, n: 0 }; // ids start at 1
    if (!prev) return;
    const keys: string[] = [];
    let i = paragraphs.length;
    while (i > 0 && paragraphs[i - 1].id >= prev.id) i--;
    for (; i < paragraphs.length; i++) {
      const p = paragraphs[i];
      for (const it of p.items.slice(p.id === prev.id ? prev.n : 0)) keys.push(it.key);
    }
    if (keys.length) onHeardRef.current?.(keys);
  }, [paragraphs]);

  // Turn the page with the reciter.
  useEffect(() => {
    if (!last || !words) return;
    const page = words.page(last);
    if (page && page !== currentPage) onNavigateToPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, words]);

  // Verify results: mark the confirmed mistakes on the mushaf (on whatever page is shown).
  const findings = results?.result?.findings;
  useEffect(() => {
    if (!findings?.length) return;
    const marked: [Element, string][] = [];
    for (const f of findings) {
      const cls = MARK_CLASS[f.kind];
      for (const k of f.keys) {
        const el = document.querySelector(`[data-w="${k}"]`);
        if (el) {
          el.classList.add(cls);
          marked.push([el, cls]);
        }
      }
      if (f.expected) {
        const el = document.querySelector(`[data-w="${f.expected}"]`);
        if (el) {
          el.classList.add("voice-slip-from");
          marked.push([el, "voice-slip-from"]);
        }
      }
    }
    return () => marked.forEach(([el, cls]) => el.classList.remove(cls));
  }, [findings, currentPage]);

  if (!supported) return { supported, following: false, button: null, strip: null };

  const start = (m: Mode) => {
    session?.dismissResults();
    startedFor.current = false;
    setWanted(m);
    if (session && phase === "ready") {
      startedFor.current = true;
      void session.start(m); // already loaded: start inside this tap
    }
  };
  const stop = () => {
    void session?.stop();
    setWanted(null);
    startedFor.current = false;
  };

  const loading = wanted !== null && !listening && !verifying && !results && (phase === "checking" || phase === "loading" || !session);
  const open = (key: string) => {
    const page = words?.page(key);
    if (page && page !== currentPage) onNavigateToPage(page);
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-w="${key}"]`);
      if (!el) return;
      keepInView(el, stripRef.current);
      el.classList.add("voice-flash");
      setTimeout(() => el.classList.remove("voice-flash"), 1600);
    }, 150);
  };

  const [s, a] = (state?.last ?? "").split(":").map(Number);
  const surahName = surahs?.find((x) => x.index === s)?.tname;
  const para = state?.paragraphs[state.paragraphs.length - 1];
  const tail = para && words ? para.items.slice(-8).map((it) => words.text(it.key)).join(" ") : "";
  const startedAt = state?.verify.startedAt;
  const left = startedAt ? Math.max(0, 15 * 60 - Math.floor((now - startedAt) / 1000)) : 0;

  const status = (() => {
    if (phase === "no-model") return "Download the speech model first";
    if (state?.message) return state.message;
    if (loading) return "Loading…";
    if (verifying) return "Checking your recitation…";
    if (phase === "stopping") return "Finishing…";
    if (!listening) return "";
    if (state?.behind) return "Can't keep up on this device";
    const where = state?.tracking && state.last ? `${surahName ?? `Surah ${s}`} ${s}:${a}` : state?.candidates.length ? "Recite a little more to confirm the place…" : "Listening… start reciting";
    return mode === "verify" ? `Verifying · ${where}` : where;
  })();

  const pill = (active: boolean) =>
    `shrink-0 flex items-center gap-1 px-2.5 sm:px-3 h-9 rounded-full text-sm font-semibold transition-colors disabled:opacity-60 ${active ? "bg-red-500 text-white" : "bg-primary text-on-primary"}`;

  const stopButton = (
    <button onClick={stop} className={pill(true)} aria-label="Stop">
      <span className="w-2.5 h-2.5 rounded-sm bg-white" />
      {mode === "verify" ? "Stop & check" : "Stop"}
    </button>
  );

  const button = listening ? (
    stopButton
  ) : (
    <div className="flex items-center gap-1.5 shrink-0">
      <button onClick={() => start("follow")} disabled={loading || verifying} className={pill(false)} title="Follow along as you recite">
        <MicIcon className="w-4 h-4" />
        {/* icon only on the narrowest phones, so the Surah/Juz menus keep room */}
        <span className="max-[399px]:sr-only">{loading && wanted === "follow" ? "Loading…" : "Follow"}</span>
      </button>
      <button
        onClick={() => start("verify")}
        disabled={loading || verifying}
        className="shrink-0 flex items-center gap-1 px-2.5 sm:px-3 h-9 rounded-full text-sm font-semibold border border-primary text-primary bg-card disabled:opacity-60"
        title="Recite, then get your mistakes"
      >
        <CheckIcon className="w-4 h-4" />
        <span className="max-[399px]:sr-only">{loading && wanted === "verify" ? "Loading…" : "Verify"}</span>
      </button>
    </div>
  );

  const showStrip = listening || verifying || phase === "no-model" || (wanted !== null && !!state?.message);
  const strip = (
    <>
      {showStrip && (
        <>
          {/* room under the page, so its last lines can scroll above the strip */}
          <div aria-hidden className="h-28" />
          <div
            ref={stripRef}
            className="fixed z-30 inset-x-0 bottom-0 bg-card border-t border-edge shadow-[0_-4px_12px_rgba(0,0,0,0.06)]"
            role="region"
            aria-label="Follow mode"
          >
            <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${state?.speaking ? "bg-primary" : "bg-edge-strong"}`} aria-hidden />
                  <span className="font-semibold text-ink truncate" data-testid="follow-status">
                    {status}
                  </span>
                  {phase === "no-model" && (
                    <Link href="/voice" className="text-primary font-semibold hover:underline">
                      Voice settings
                    </Link>
                  )}
                  {listening && (
                    <>
                      {mode === "verify" && (
                        <span className="ml-auto text-faint tabular-nums shrink-0" title="Verify recordings are limited to 15 minutes">
                          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} left
                        </span>
                      )}
                      <Link href="/transcribe" className={`${mode === "verify" ? "" : "ml-auto"} text-muted hover:text-ink shrink-0`}>
                        Transcript
                      </Link>
                      <button onClick={() => setCollapsed((c) => !c)} className="text-muted hover:text-ink shrink-0" aria-label={collapsed ? "Show words" : "Hide words"}>
                        {collapsed ? "▴" : "▾"}
                      </button>
                    </>
                  )}
                </div>
                {listening && !collapsed && (
                  <p dir="rtl" lang="ar" className="font-arabic text-lg leading-relaxed text-ink-soft truncate min-h-[1.75rem]" aria-live="off">
                    {tail}
                  </p>
                )}
              </div>
              {listening && stopButton}
            </div>
          </div>
        </>
      )}
      {results && (
        <>
          <div aria-hidden className="h-[45vh]" />
          <div className="fixed z-30 inset-x-0 bottom-0 max-h-[45vh] overflow-y-auto bg-card border-t border-edge shadow-[0_-4px_16px_rgba(0,0,0,0.1)]" role="dialog" aria-label="Verify results">
            <div className="max-w-3xl mx-auto px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <h2 className="text-sm font-semibold text-ink">Your recitation</h2>
                <button onClick={() => session?.dismissResults()} className="ml-auto text-xs font-medium text-muted hover:text-ink">
                  Close
                </button>
              </div>
              {results.result ? (
                <Suspense fallback={<p className="text-sm text-muted">…</p>}>
                  <VerifyResults result={results.result} words={words} surahs={surahs} onOpen={open} />
                </Suspense>
              ) : (
                <p className="text-sm text-red-500">The check failed: {results.error}</p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );

  return { supported, following: listening, button, strip };
}
