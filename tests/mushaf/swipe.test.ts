import { describe, expect, it } from "vitest";
import { atScreenEdge, dragAxis, dragOffset, settleMs, settleSwipe, SWIPE_RUBBER } from "@/lib/mushaf/swipe";

const both = { next: true, prev: true };

describe("swiping to turn pages", () => {
  it("tells a sideways drag from a tap, a scroll and a long press", () => {
    expect(dragAxis(3, 2, 50)).toBeNull();
    expect(dragAxis(20, 4, 80)).toBe("x");
    expect(dragAxis(-20, 4, 80)).toBe("x");
    expect(dragAxis(4, 20, 80)).toBe("none");
    expect(dragAxis(15, 14, 80)).toBe("none");
    expect(dragAxis(20, 0, 800)).toBe("none");
  });

  it("follows the finger, and holds back past the first or last page", () => {
    expect(dragOffset(100, both)).toBe(100);
    expect(dragOffset(-100, both)).toBe(-100);
    expect(dragOffset(100, { next: false, prev: true })).toBeCloseTo(100 * SWIPE_RUBBER);
    expect(dragOffset(-100, { next: true, prev: false })).toBeCloseTo(-100 * SWIPE_RUBBER);
  });

  it("turns to the next page when pulled right, the previous when pulled left (the mushaf reads right to left)", () => {
    expect(settleSwipe({ dx: 150, velocity: 0, width: 400 }, both)).toBe("next");
    expect(settleSwipe({ dx: -150, velocity: 0, width: 400 }, both)).toBe("prev");
  });

  it("slides back when not pulled far enough", () => {
    expect(settleSwipe({ dx: 60, velocity: 0.05, width: 400 }, both)).toBeNull();
  });

  it("turns on a quick flick even when short", () => {
    expect(settleSwipe({ dx: 50, velocity: 0.8, width: 400 }, both)).toBe("next");
    expect(settleSwipe({ dx: -50, velocity: -0.8, width: 400 }, both)).toBe("prev");
  });

  it("does not turn when flicked back the other way", () => {
    expect(settleSwipe({ dx: 150, velocity: -0.8, width: 400 }, both)).toBeNull();
  });

  it("never turns past the first or last page", () => {
    expect(settleSwipe({ dx: 300, velocity: 1, width: 400 }, { next: false, prev: true })).toBeNull();
    expect(settleSwipe({ dx: -300, velocity: -1, width: 400 }, { next: true, prev: false })).toBeNull();
  });

  it("settles faster when little is left to go", () => {
    expect(settleMs(20, 400)).toBeLessThan(settleMs(380, 400));
  });

  it("leaves the screen's side edges to the system's back gesture", () => {
    expect(atScreenEdge(5, 400)).toBe(true);
    expect(atScreenEdge(395, 400)).toBe(true);
    expect(atScreenEdge(200, 400)).toBe(false);
  });
});
