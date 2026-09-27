import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useVoice, voiceNow } from "@/recitation/session/lazy";
import { wordLookup } from "@/recitation/session/words";
import { getVoiceSupport } from "@/recitation/support";
import type { QuranPage, SurahMeta } from "@/types";

/**
 * Follow mode in the reader (spec §8.1): the Follow button, the current-word highlight on the mushaf, automatic
 * page turns, and a strip under the page with where you are and the last words heard. Nothing is marked as a
 * mistake in follow mode. The voice session itself loads only when Follow is first tapped.
 */
export default function FollowControl({
  pages,
  surahs,
  currentPage,
  onNavigateToPage,
}: {
  pages: QuranPage[] | undefined;
  surahs: SurahMeta[] | undefined;
  currentPage: number;
  onNavigateToPage: (page: number) => void;
}) {
  const supported = useMemo(() => getVoiceSupport().supported, []);
  const [wanted, setWanted] = useState(() => voiceNow()?.getState().phase === "listening");
  const { session, state } = useVoice(wanted);
  const words = useMemo(() => (pages ? wordLookup(pages) : null), [pages]);
  const [collapsed, setCollapsed] = useState(false);
  const startedFor = useRef(false);
  const phase = state?.phase;
  const following = phase === "listening" || phase === "stopping";

  // First tap loads the session; start listening as soon as it's ready.
  useEffect(() => {
    if (wanted && session && phase === "ready" && !startedFor.current) {
      startedFor.current = true;
      void session.start();
    }
  }, [wanted, session, phase]);

  // Highlight the word just recited, straight on the DOM (no page re-render per step).
  const last = following ? state?.last ?? null : null;
  useEffect(() => {
    if (!last) return;
    const el = document.querySelector(`[data-w="${last}"]`);
    el?.classList.add("voice-current");
    (el as HTMLElement | null)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    return () => el?.classList.remove("voice-current");
  }, [last, currentPage]);

  // Turn the page with the reciter.
  useEffect(() => {
    if (!last || !words) return;
    const page = words.page(last);
    if (page && page !== currentPage) onNavigateToPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last, words]);

  if (!supported) return null;

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

  return (
    <>
      <button
        onClick={toggle}
        aria-pressed={following}
        className={`fixed z-40 right-4 bottom-20 sm:bottom-6 flex items-center gap-2 pl-3 pr-4 h-11 rounded-full shadow-lg text-sm font-semibold transition-colors ${
          following ? "bg-red-500 text-white" : "bg-primary text-on-primary"
        }`}
      >
        {following ? (
          <span className="w-3 h-3 rounded-sm bg-white" />
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 003-3V6a3 3 0 10-6 0v6a3 3 0 003 3zm6-3a6 6 0 01-12 0m6 6v3m-3 0h6" />
          </svg>
        )}
        {following ? "Stop" : loading ? "Loading…" : "Follow"}
      </button>

      {(following || phase === "no-model" || (wanted && state?.message)) && (
        <div className="fixed z-30 inset-x-0 bottom-0 bg-card/95 backdrop-blur border-t border-edge" role="region" aria-label="Follow mode">
          <div className="max-w-3xl mx-auto px-4 py-2 pr-32">
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${state?.speaking ? "bg-primary" : "bg-edge-strong"}`} aria-hidden />
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
                  <Link href="/transcribe" className="ml-auto text-muted hover:text-ink">
                    Transcript
                  </Link>
                  <button onClick={() => setCollapsed((c) => !c)} className="text-muted hover:text-ink" aria-label={collapsed ? "Show words" : "Hide words"}>
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
        </div>
      )}
    </>
  );
}
