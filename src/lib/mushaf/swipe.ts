/**
 * Swiping to turn the reader's pages. Plain TS, tested in tests/mushaf/swipe.test.ts.
 *
 * The mushaf reads right to left, so the next page lies to the left of this one (as the Left arrow key turns
 * to it): a swipe to the right pulls it in, a swipe to the left goes back. Only a quick, clearly sideways
 * stroke counts, so scrolling, a long press that selects text, a slow drag and a tap all stay what they were.
 */
export type SwipeTurn = "next" | "prev";

export interface SwipeStroke {
  /** where the finger came down and lifted, in CSS pixels */
  dx: number;
  dy: number;
  /** how long the finger was down */
  ms: number;
}

/** at least this far sideways */
export const SWIPE_MIN_PX = 50;
/** and at least this many times more sideways than up or down */
export const SWIPE_RATIO = 1.75;
/** and done within this long: a longer hold is a long press (text selection) or a drag */
export const SWIPE_MAX_MS = 700;
/** touches that start this close to the screen's side edge belong to the system's back/forward gesture */
export const SWIPE_EDGE_PX = 20;

/** The page turn a stroke asks for, or null when it is not a swipe. */
export function classifySwipe({ dx, dy, ms }: SwipeStroke): SwipeTurn | null {
  if (ms > SWIPE_MAX_MS) return null;
  if (Math.abs(dx) < SWIPE_MIN_PX) return null;
  if (Math.abs(dx) < SWIPE_RATIO * Math.abs(dy)) return null;
  return dx > 0 ? "next" : "prev";
}

/** Whether a touch starting at `x` on a screen `width` wide is too close to its side edges to start a swipe. */
export function atScreenEdge(x: number, width: number): boolean {
  return x < SWIPE_EDGE_PX || x > width - SWIPE_EDGE_PX;
}
