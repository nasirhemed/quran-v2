/**
 * Swiping the reader's pages, the way a page is pulled across with a finger. Plain TS, tested in
 * tests/mushaf/swipe.test.ts; `hooks/useSwipePager.ts` drives it.
 *
 * The mushaf reads right to left, so the next page lies to the left of this one (as the Left arrow key turns
 * to it): dragging to the right pulls it in from the left, dragging to the left brings back the previous page
 * from the right. The page follows the finger; on release it turns if it was pulled a quarter of the way, or
 * flicked, and otherwise slides back.
 */
export type SwipeTurn = "next" | "prev";

/** movement before a touch counts as a drag one way or the other (a tap moves less) */
export const SWIPE_SLOP_PX = 8;
/** a drag must be this many times more sideways than up or down (otherwise it is a scroll) */
export const SWIPE_RATIO = 1.2;
/** a finger held this long before moving is a long press (the verse's menu: hooks/useAyahLongPress), not a swipe */
export const SWIPE_HOLD_MS = 500;
/** touches that start this close to the screen's side edge belong to the system's back/forward gesture */
export const SWIPE_EDGE_PX = 20;
/** released past this share of the width, the page turns */
export const SWIPE_COMMIT_SHARE = 0.25;
/** or flicked at least this fast (px/ms) over at least SWIPE_FLICK_MIN_PX */
export const SWIPE_FLICK_SPEED = 0.35;
export const SWIPE_FLICK_MIN_PX = 30;
/** beyond the first or last page the page gives this much of the finger's movement, then stops */
export const SWIPE_RUBBER = 0.3;
/** the space between neighbouring pages while they slide */
export const SWIPE_GAP_PX = 16;

/** Whether a touch starting at `x` on a screen `width` wide is too close to its side edges to start a swipe. */
export function atScreenEdge(x: number, width: number): boolean {
  return x < SWIPE_EDGE_PX || x > width - SWIPE_EDGE_PX;
}

/**
 * What a touch that has moved (dx, dy) after `ms` is: a sideways drag ("x"), anything else ("none": a scroll,
 * a long press), or still undecided (null, under the slop).
 */
export function dragAxis(dx: number, dy: number, ms: number): "x" | "none" | null {
  if (Math.hypot(dx, dy) < SWIPE_SLOP_PX) return null;
  if (ms > SWIPE_HOLD_MS) return "none";
  return Math.abs(dx) > SWIPE_RATIO * Math.abs(dy) ? "x" : "none";
}

/** The turn a drag of `dx` asks for: right → next, left → previous. */
export function turnOf(dx: number): SwipeTurn {
  return dx > 0 ? "next" : "prev";
}

/** Where the page sits under a finger that has moved `dx`: with it, or held back where there is no page to turn to. */
export function dragOffset(dx: number, can: { next: boolean; prev: boolean }): number {
  return can[turnOf(dx)] ? dx : dx * SWIPE_RUBBER;
}

/**
 * Whether a drag released at `dx`, moving at `velocity` (px/ms, + = rightwards), over pages `width` wide turns
 * the page, and which way; null slides it back.
 */
export function settleSwipe(
  { dx, velocity, width }: { dx: number; velocity: number; width: number },
  can: { next: boolean; prev: boolean }
): SwipeTurn | null {
  const turn = turnOf(dx);
  if (!can[turn] || dx === 0) return null;
  const far = Math.abs(dx) >= SWIPE_COMMIT_SHARE * width;
  const flick = Math.abs(dx) >= SWIPE_FLICK_MIN_PX && Math.abs(velocity) >= SWIPE_FLICK_SPEED && Math.sign(velocity) === Math.sign(dx);
  // a flick back the other way cancels a long pull
  const flickedBack = Math.abs(velocity) >= SWIPE_FLICK_SPEED && Math.sign(velocity) !== Math.sign(dx);
  return (far && !flickedBack) || flick ? turn : null;
}

/** How long the slide to rest takes for `distance` px left to go (shorter when little is left). */
export function settleMs(distance: number, width: number): number {
  return Math.round(120 + 160 * Math.min(1, Math.abs(distance) / Math.max(1, width)));
}
