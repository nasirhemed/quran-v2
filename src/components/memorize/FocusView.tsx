import { useEffect, useMemo, useRef, useState } from "react";
import type { MemorizeSession, MemorizeState } from "@/memorize/session";
import type { Verse } from "@/lib/memorize";

/**
 * The session screen: full screen, the verse as large as it fits, one big state line ("Listen" / "Your turn"),
 * one big Pause button. Made to be read at a glance (a phone on a stand, or in a car mount).
 *
 * On your turn the words the speech model has heard turn green; hinted words (after a pause) show in gold; with
 * "hide", the others are blank until heard or hinted (tap the verse to see it all).
 */

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

interface Props {
  session: MemorizeSession;
  state: MemorizeState;
  verses: Verse[];
  surahName: (s: number) => string;
  words: (ayah: string) => { key: string; text: string }[];
  reps: number;
  listen: number;
  hide: boolean;
}

/** Larger text for shorter verses; long ones scroll. */
function verseSize(n: number) {
  if (n <= 8) return "text-4xl sm:text-5xl leading-[2]";
  if (n <= 16) return "text-3xl sm:text-4xl leading-[2.1]";
  if (n <= 30) return "text-2xl sm:text-3xl leading-[2.2]";
  return "text-xl sm:text-2xl leading-[2.2]";
}

export default function FocusView({ session, state, verses, surahName, words, reps, listen, hide }: Props) {
  const step = state.step;
  const verse = step ? verses[step.verse] : null;
  const ayah = verse ? `${verse.s}:${verse.a}` : "";
  const list = useMemo(() => (ayah ? words(ayah) : []), [ayah, words]);
  const yourTurn = step?.turn === "you";
  const heard = useMemo(() => new Set(yourTurn ? state.heard : []), [yourTurn, state.heard]);
  const [peek, setPeek] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  // a new verse or turn hides it again
  useEffect(() => {
    setPeek(false);
  }, [step?.verse, step?.rep, step?.turn]);

  // keep the next word to recite (or the hint) in view on long verses
  const heardTo = useMemo(() => list.reduce((m, w, i) => (heard.has(w.key) ? i + 1 : m), 0), [list, heard]);
  const focus = Math.max(heardTo, state.hintTo);
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-i="${Math.min(focus, list.length - 1)}"]`);
    if (el && yourTurn) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus, yourTurn, list.length]);

  const paused = state.phase === "paused";
  const title = (() => {
    if (state.phase === "starting") return "Starting…";
    if (paused) return "Paused";
    if (!step) return "";
    if (state.activity === "loading") return yourTurn ? "Getting ready…" : "Loading…";
    if (yourTurn) return state.verseDone ? "✓" : "Your turn";
    return step.turn === "listen" && listen > 1 ? `Listen ${step.rep}/${listen}` : "Listen";
  })();
  const dots = step && step.turn !== "listen" ? reps : 0;
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length] ?? 1;

  return (
    <div className="fixed inset-0 z-[60] bg-ground flex flex-col" role="dialog" aria-label="Memorize session">
      <div className="flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2">
        <button onClick={() => session.stop()} aria-label="Stop" className="w-10 h-10 -ml-2 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-card2">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-sm font-semibold text-ink truncate">{verse ? `${surahName(verse.s)} ${verse.s}:${verse.a}` : ""}</div>
          <div className="text-xs text-muted">{step ? `verse ${step.verse + 1} of ${verses.length}` : ""}</div>
        </div>
        <button onClick={() => session.setSpeed(nextSpeed)} aria-label={`Speed ${state.speed}×, tap for ${nextSpeed}×`} className="min-w-12 h-9 px-2 rounded-full border border-edge-strong text-sm font-semibold text-ink tabular-nums">
          {state.speed}×
        </button>
      </div>

      <div className="text-center px-4 pt-2">
        <div className={`text-5xl sm:text-6xl font-bold tracking-tight ${yourTurn && !paused ? "text-primary" : "text-ink"}`}>{title}</div>
        {dots > 0 && step && (
          <div className="flex justify-center gap-2 mt-3" aria-label={`Repetition ${step.rep} of ${reps}`}>
            {Array.from({ length: dots }, (_, i) => (
              <span key={i} className={`h-3 w-3 rounded-full ${i + 1 < step.rep || (i + 1 === step.rep && yourTurn) ? "bg-primary" : i + 1 === step.rep ? "bg-gold" : "bg-card2 border border-edge"}`} />
            ))}
          </div>
        )}
      </div>

      <div ref={scroller} className="flex-1 min-h-0 overflow-auto px-5 py-4 flex">
        <p dir="rtl" lang="ar" onClick={() => setPeek(true)} className={`m-auto font-arabic text-ink text-center select-none ${verseSize(list.length)}`}>
          {list.map((w, i) => {
            const got = heard.has(w.key);
            const hinted = !got && yourTurn && i < state.hintTo;
            const blank = hide && yourTurn && !peek && !got && !hinted;
            return (
              <span
                key={w.key}
                data-i={i}
                className={`transition-colors ${got ? "text-primary" : hinted ? "text-gold-text bg-gold-soft rounded" : blank ? "text-transparent border-b-2 border-edge-strong" : ""}`}
              >
                {w.text}{" "}
              </span>
            );
          })}
        </p>
      </div>

      <div className="px-4 pb-[max(env(safe-area-inset-bottom),1rem)] space-y-3">
        <div className="h-1.5 rounded-full bg-card2 overflow-hidden" aria-hidden>
          <div
            className={`h-full transition-[width] duration-75 ${state.speaking ? "bg-primary" : "bg-muted"}`}
            style={{ width: `${yourTurn && state.activity === "listening" ? Math.max(0, Math.min(100, ((state.level + 70) / 70) * 100)) : 0}%` }}
          />
        </div>
        <div className="text-xs text-muted text-center h-4">
          {yourTurn && state.activity === "listening"
            ? state.model === "ready"
              ? state.hintTo > heardTo
                ? "Hint shown · carry on when you remember"
                : "Moves on when you finish the verse"
              : "Moves on when you stop"
            : state.model === "loading"
              ? "Loading the speech model…"
              : ""}
        </div>
        {paused ? (
          <button onClick={() => session.resume()} className="w-full bg-primary text-on-primary rounded-2xl py-6 text-2xl font-bold">
            Resume
          </button>
        ) : (
          <button onClick={() => session.pause()} disabled={state.phase !== "running"} className="w-full bg-primary text-on-primary rounded-2xl py-6 text-2xl font-bold disabled:opacity-50">
            Pause
          </button>
        )}
        <div className="grid grid-cols-3 gap-3">
          <button onClick={() => session.again()} className="border border-edge-strong text-ink rounded-xl py-3 text-sm font-medium hover:bg-card2">
            Again
          </button>
          <button onClick={() => session.next()} disabled={state.phase !== "running"} className="border border-edge-strong text-ink rounded-xl py-3 text-sm font-medium hover:bg-card2 disabled:opacity-40">
            {yourTurn ? "Done" : "Skip"}
          </button>
          <button onClick={() => session.nextVerse()} className="border border-edge-strong text-ink rounded-xl py-3 text-sm font-medium hover:bg-card2">
            Next verse
          </button>
        </div>
      </div>
    </div>
  );
}
