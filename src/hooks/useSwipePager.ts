import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  atScreenEdge,
  dragAxis,
  dragOffset,
  settleMs,
  settleSwipe,
  SWIPE_GAP_PX,
  type SwipeTurn,
} from "@/lib/mushaf/swipe";

interface Options {
  /** whether there is a next / previous page (spread) to turn to */
  canNext: boolean;
  canPrev: boolean;
  onNext: () => void;
  onPrev: () => void;
  enabled?: boolean;
  /** the reader's place: when it changes the track is put back under the new page before it paints */
  page: number;
}

const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/**
 * Pulls the reader's pages across under a finger (`lib/mushaf/swipe.ts` decides what a stroke is and where it
 * settles). `bind` goes on the viewport (it gets `touch-action: pan-y pinch-zoom`, so the browser keeps vertical
 * scrolling and pinch zoom, and sideways strokes come here), `trackRef` on the element that slides, which holds
 * the current page with the next page to its left and the previous to its right (always there, so a swipe
 * starts without rendering anything). The track is moved straight on the DOM: a swipe never re-renders React. On release it slides on to the neighbour and
 * then turns the page, or slides back; the turn re-renders the track with the new page in the middle and it is
 * put back at 0 in a layout effect, so nothing jumps.
 *
 * Left alone: touches from the screen's side edge (the system's back gesture), a second finger (pinch), a long
 * press (text selection) or a touch that leaves text selected, a page zoomed in (a sideways stroke pans it),
 * mouse and pen (a mouse drag selects text; the arrows and keys turn pages there).
 */
export function useSwipePager({ canNext, canPrev, onNext, onPrev, enabled = true, page }: Options) {
  const [el, bind] = useState<HTMLElement | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ canNext, canPrev, onNext, onPrev });
  latest.current = { canNext, canPrev, onNext, onPrev };
  const timer = useRef<number | undefined>(undefined);

  const place = useCallback((x: number, ms = 0) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = ms ? `transform ${ms}ms ${EASE}` : "none";
    track.style.willChange = x ? "transform" : "";
    track.style.transform = x ? `translate3d(${x}px,0,0)` : "";
  }, []);

  // The page turned (by this pager or anything else): the new page is in the middle, so the track goes back to 0.
  useLayoutEffect(() => {
    window.clearTimeout(timer.current);
    place(0);
  }, [page, place]);

  useEffect(() => {
    if (!el || !enabled) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let start: { id: number; x: number; y: number; t: number } | null = null;
    let dragging = false;
    let samples: { x: number; t: number }[] = [];
    let suppressClickUntil = 0;

    const can = () => ({ next: latest.current.canNext, prev: latest.current.canPrev });
    const width = () => el.clientWidth + SWIPE_GAP_PX;

    const slideTo = (x: number, then: () => void) => {
      window.clearTimeout(timer.current);
      const current = samples.length ? samples[samples.length - 1].x - (start?.x ?? 0) : 0;
      const ms = reduceMotion ? 0 : settleMs(x - current, width());
      place(x, ms);
      timer.current = window.setTimeout(then, ms + 20);
    };

    const release = (cancelled: boolean, e?: PointerEvent) => {
      const s = start;
      start = null;
      if (!dragging || !s) return;
      dragging = false;
      suppressClickUntil = performance.now() + 400;
      const dx = (e ? e.clientX : samples[samples.length - 1]?.x ?? s.x) - s.x;
      const t = e ? e.timeStamp : performance.now();
      // speed over the last ~100 ms
      const recent = samples.filter((p) => t - p.t <= 100);
      const first = recent[0] ?? samples[samples.length - 1];
      const velocity = first && t > first.t ? ((e ? e.clientX : first.x) - first.x) / (t - first.t) : 0;
      const turn: SwipeTurn | null = cancelled ? null : settleSwipe({ dx, velocity, width: el.clientWidth }, can());
      if (turn) {
        slideTo(turn === "next" ? width() : -width(), () => {
          // the turn re-renders the track with the new page in the middle; the layout effect puts it back at 0
          // if the page does not change after all, slide back (a turn clears this in the layout effect)
          timer.current = window.setTimeout(() => {
            place(0);
          }, 600);
          if (turn === "next") latest.current.onNext();
          else latest.current.onPrev();
        });
      } else {
        slideTo(0, () => {
          place(0);
        });
      }
      samples = [];
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      if (!e.isPrimary) {
        // a second finger: pinch zoom, not a swipe
        if (dragging) release(true);
        start = null;
        return;
      }
      if (atScreenEdge(e.clientX, window.innerWidth)) return;
      if ((window.visualViewport?.scale ?? 1) > 1.01) return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
      samples = [{ x: e.clientX, t: e.timeStamp }];
    };

    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      if (!dragging) {
        const axis = dragAxis(dx, e.clientY - start.y, e.timeStamp - start.t);
        if (axis === null) return;
        const selection = window.getSelection();
        if (axis === "none" || (selection && !selection.isCollapsed)) {
          start = null;
          return;
        }
        dragging = true;
        window.clearTimeout(timer.current);
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // the pointer is gone
        }
      }
      samples.push({ x: e.clientX, t: e.timeStamp });
      if (samples.length > 12) samples.shift();
      place(dragOffset(dx, can()));
    };

    const onUp = (e: PointerEvent) => {
      if (start && e.pointerId === start.id) release(false, e);
    };
    const onCancel = (e: PointerEvent) => {
      if (start && e.pointerId === start.id) release(true);
    };
    // a drag that ends over a word must not also tap it (reveal a hidden word, open a highlight)
    const onClick = (e: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    };

    el.style.touchAction = "pan-y pinch-zoom";
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    el.addEventListener("click", onClick, true);
    return () => {
      el.style.touchAction = "";
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("click", onClick, true);
      window.clearTimeout(timer.current);
      place(0);
    };
  }, [el, enabled, place]);

  return { bind, trackRef };
}
