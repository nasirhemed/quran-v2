import { useEffect, useRef } from "react";
import { atScreenEdge, classifySwipe } from "@/lib/mushaf/swipe";

/**
 * Turns pages on a sideways swipe over `el` (the reader's page area): right → next, left → previous,
 * as `lib/mushaf/swipe.ts` decides. Touch events, passive, so vertical scrolling and pinch zoom are untouched; a
 * stroke is ignored when more than one finger was down, when it leaves text selected, when the page is zoomed
 * in (the sideways stroke is panning), and when it starts at the screen's side edge (the system's back gesture).
 * `el` is the element itself (a callback ref's state), so the listeners follow it when it mounts after loading.
 */
export function useSwipePages(
  el: HTMLElement | null,
  { onNext, onPrev, enabled = true }: { onNext: () => void; onPrev: () => void; enabled?: boolean }
) {
  // The latest handlers, so the listeners are attached once.
  const handlers = useRef({ onNext, onPrev });
  handlers.current = { onNext, onPrev };

  useEffect(() => {
    if (!el || !enabled) return;
    let start: { x: number; y: number; t: number } | null = null;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        start = null; // a second finger: pinch zoom, not a swipe
        return;
      }
      const t = e.touches[0];
      start = atScreenEdge(t.clientX, window.innerWidth) ? null : { x: t.clientX, y: t.clientY, t: e.timeStamp };
    };
    const onEnd = (e: TouchEvent) => {
      const s = start;
      start = null;
      if (!s || e.touches.length > 0) return;
      const t = e.changedTouches[0];
      if (!t) return;
      if ((window.visualViewport?.scale ?? 1) > 1.01) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const turn = classifySwipe({ dx: t.clientX - s.x, dy: t.clientY - s.y, ms: e.timeStamp - s.t });
      if (turn === "next") handlers.current.onNext();
      else if (turn === "prev") handlers.current.onPrev();
    };
    const onCancel = () => {
      start = null;
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onCancel, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onCancel);
    };
  }, [el, enabled]);
}
