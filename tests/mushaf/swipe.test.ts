import { describe, expect, it } from "vitest";
import { atScreenEdge, classifySwipe } from "@/lib/mushaf/swipe";

describe("swiping to turn pages", () => {
  it("turns to the next page on a swipe right and back on a swipe left (the mushaf reads right to left)", () => {
    expect(classifySwipe({ dx: 120, dy: 10, ms: 200 })).toBe("next");
    expect(classifySwipe({ dx: -120, dy: -10, ms: 200 })).toBe("prev");
  });

  it("ignores taps and short nudges", () => {
    expect(classifySwipe({ dx: 0, dy: 0, ms: 80 })).toBeNull();
    expect(classifySwipe({ dx: 30, dy: 2, ms: 150 })).toBeNull();
  });

  it("ignores scrolling and diagonal strokes", () => {
    expect(classifySwipe({ dx: 10, dy: 200, ms: 250 })).toBeNull();
    expect(classifySwipe({ dx: 100, dy: 80, ms: 250 })).toBeNull();
  });

  it("ignores long presses and slow drags (text selection)", () => {
    expect(classifySwipe({ dx: 150, dy: 5, ms: 900 })).toBeNull();
  });

  it("leaves the screen's side edges to the system's back gesture", () => {
    expect(atScreenEdge(5, 400)).toBe(true);
    expect(atScreenEdge(395, 400)).toBe(true);
    expect(atScreenEdge(200, 400)).toBe(false);
  });
});
