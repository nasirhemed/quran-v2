import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useVoice, voiceNow } from "@/recitation/session/lazy";
import { wordLookup } from "@/recitation/session/words";
import { getVoiceSupport } from "@/recitation/support";
import type { QuranPage, SurahMeta } from "@/types";

/**
 * Follow mode in the reader (spec §8.1): the Follow button (placed in the navigation bar, never over the text),
 * the current-word ring on the mushaf, automatic page turns, and a strip under the page with where you are, the
 * last words heard and Stop. Nothing is marked as a mistake in follow mode. The voice session itself loads only
 * when Follow is first tapped.
 */

const MicIcon = ({ className }: { className: string }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm6-3a6 6 0 01-12 0m6 6v3m-3 0h6" />
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
  const [wanted, setWanted] = useState(() => voiceNow()?.getState().phase === "listening");
  const { session, state } = useVoice(wanted);
  const words = useMemo(() => (pages ? wordLookup(pages) : null), [pages]);
  const [collapsed, setCollapsed] = useState(false);
  const startedFor = useRef(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const phase = state?.phase;
  const following = phase === "listening" || phase === "stopping";

  // First tap loads the session; start listening as soon as it's ready.
  useEffect(() => {
    if (wanted && session && phase === "ready" && !startedFor.current) {
      startedFor.current = true;
      void session.start();
    }
  }, [wanted, session, phase]);

  // Ring the word just recited, straight on the DOM (no page re-render per step), and keep it in view.
  const last = following ? state?.last ?? null : null;
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

  if (!supported) return { supported, following: false, button: null, strip: null };

  const toggle = () => {
    if (following) {
      void session?.stop();
      setWanted(false);
      startedFor.current = false;
    } else {
      startedFor.current = false;
      setWanted(true);
      if (session && phase === "ready") {
        startedFor.current = true;
        void session.start(); // already loaded: start inside this tap
      }
    }
  };

  const loading = wanted && !following && (phase === "checking" || phase === "loading" || !session);
  const [s, a] = (state?.last ?? "").split(":").map(Number);
  const surahName = surahs?.find((x) => x.index === s)?.tname;
  const para = state?.paragraphs[state.paragraphs.length - 1];
  const tail = para && words ? para.items.slice(-8).map((it) => words.text(it.key)).join(" ") : "";

  const status = (() => {
    if (phase === "no-model") return "Download the speech model first";
    if (state?.message) return state.message;
    if (loading) return "Loading…";
    if (phase === "stopping") return "Finishing…";
    if (!following) return "";
    if (state?.behind) return "Can't keep up on this device";
    if (state?.tracking && state.last) return `${surahName ?? `Surah ${s}`} ${s}:${a}`;
    if (state?.candidates.length) return "Recite a little more to confirm the place…";
    return "Listening… start reciting";
  })();

  const button = (
    <button
      onClick={toggle}
      aria-pressed={following}
      disabled={loading}
      className={`shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-full text-sm font-semibold transition-colors disabled:opacity-60 ${
        following ? "bg-red-500 text-white" : "bg-primary text-on-primary"
      }`}
    >
      {following ? <span className="w-2.5 h-2.5 rounded-sm bg-white" /> : <MicIcon className="w-4 h-4" />}
      {following ? "Stop" : loading ? "Loading…" : "Follow"}
    </button>
  );

  const showStrip = following || phase === "no-model" || (wanted && !!state?.message);
  const strip = showStrip ? (
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
              {following && (
                <>
                  <Link href="/transcribe" className="ml-auto text-muted hover:text-ink shrink-0">
                    Transcript
                  </Link>
                  <button onClick={() => setCollapsed((c) => !c)} className="text-muted hover:text-ink shrink-0" aria-label={collapsed ? "Show words" : "Hide words"}>
                    {collapsed ? "▴" : "▾"}
                  </button>
                </>
              )}
            </div>
            {following && !collapsed && (
              <p dir="rtl" lang="ar" className="font-arabic text-lg leading-relaxed text-ink-soft truncate min-h-[1.75rem]" aria-live="off">
                {tail}
              </p>
            )}
          </div>
          {following && button}
        </div>
      </div>
    </>
  ) : null;

  return { supported, following, button, strip };
}
