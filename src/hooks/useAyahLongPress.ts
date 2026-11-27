import { useEffect, useRef, useState } from "react";
import { SWIPE_HOLD_MS, SWIPE_SLOP_PX } from "@/lib/mushaf/swipe";
import { parseAyahRef, type AyahRef } from "@/lib/ayahActions";

interface Options {
  onPress: (ref: AyahRef) => void;
  enabled?: boolean;
}

/** The verse under an event's target: a word (`data-w`) or its ornament (`data-a`), on the page in view. */
function ayahUnder(target: EventTarget | null): AyahRef | null {
  const el = (target as Element | null)?.closest?.("[data-w],[data-a]") as HTMLElement | null;
  if (!el || el.closest("[inert]")) return null;
  return parseAyahRef(el.dataset.w ?? el.dataset.a);
}

/**
 * A still long press on a verse opens its menu (pages don't select text under a finger: index.css). `bind` goes
 * on the reader's viewport, the same element as useSwipePager's, and the two agree on what a press is: a finger
 * that moves SWIPE_SLOP_PX before SWIPE_HOLD_MS is a swipe or a scroll and never opens the menu; one held still
 * that long opens it, and after that the pager ignores the stroke (it is past SWIPE_HOLD_MS). A second finger
 * (pinch) cancels it. The tap that ends the press does not also tap the word (open a highlight, reveal a word).
 *
 * A right click opens it too (a mouse still selects text, and with text selected the browser's own menu shows).
 */
export function useAyahLongPress({ onPress, enabled = true }: Options) {
  const [el, bind] = useState<HTMLElement | null>(null);
  const latest = useRef(onPress);
  latest.current = onPress;

  useEffect(() => {
    if (!el || !enabled) return;
    let press: { id: number; x: number; y: number; timer: number } | null = null;
    let suppressClickUntil = 0;
    let lastTouch = -Infinity;

    const cancel = () => {
      if (press) window.clearTimeout(press.timer);
      press = null;
    };
    const fire = (ref: AyahRef) => {
      cancel();
      suppressClickUntil = performance.now() + 700;
      navigator.vibrate?.(8);
      latest.current(ref);
    };

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      lastTouch = performance.now();
      if (!e.isPrimary) return cancel();
      cancel();
      const ref = ayahUnder(e.target);
      if (!ref) return;
      const timer = window.setTimeout(() => fire(ref), SWIPE_HOLD_MS);
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, timer };
    };
    const onMove = (e: PointerEvent) => {
      if (!press || e.pointerId !== press.id) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) >= SWIPE_SLOP_PX) cancel();
    };
    const onEnd = (e: PointerEvent) => {
      if (press && e.pointerId === press.id) cancel();
    };
    const onClick = (e: MouseEvent) => {
      if (performance.now() < suppressClickUntil) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    // Android sends a long press as contextmenu too: never the browser's menu under a finger. It may come before
    // the timer, so it opens the menu then; after the timer, the menu is already open.
    const onContextMenu = (e: MouseEvent) => {
      const touch = (e as PointerEvent).pointerType === "touch" || performance.now() - lastTouch < 1500;
      if (touch) {
        e.preventDefault();
        if (press) {
          const ref = ayahUnder(e.target);
          if (ref) fire(ref);
        }
        return;
      }
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const ref = ayahUnder(e.target);
      if (!ref) return;
      e.preventDefault();
      latest.current(ref);
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onEnd);
    el.addEventListener("pointercancel", onEnd);
    el.addEventListener("click", onClick, true);
    el.addEventListener("contextmenu", onContextMenu);
    return () => {
      cancel();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onEnd);
      el.removeEventListener("pointercancel", onEnd);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("contextmenu", onContextMenu);
    };
  }, [el, enabled]);

  return { bind };
}
