import { describe, expect, it } from "vitest";
import { nextSpreadPage, prevSpreadPage, spreadOf } from "@/lib/mushaf/spread";

describe("two-page spreads", () => {
  it("puts the odd page on the right and the next page on its left", () => {
    expect(spreadOf(1, 604)).toEqual({ right: 1, left: 2 });
    expect(spreadOf(2, 604)).toEqual({ right: 1, left: 2 });
    expect(spreadOf(4, 604)).toEqual({ right: 3, left: 4 });
    expect(spreadOf(604, 604)).toEqual({ right: 603, left: 604 });
  });

  it("leaves the left page empty past the last page", () => {
    expect(spreadOf(605, 605)).toEqual({ right: 605, left: null });
  });

  it("steps by a spread from either page", () => {
    expect(nextSpreadPage(3, 604)).toBe(5);
    expect(nextSpreadPage(4, 604)).toBe(5);
    expect(prevSpreadPage(4, 604)).toBe(1);
    expect(prevSpreadPage(5, 604)).toBe(3);
  });

  it("stops at either end", () => {
    expect(prevSpreadPage(1, 604)).toBeNull();
    expect(prevSpreadPage(2, 604)).toBeNull();
    expect(nextSpreadPage(603, 604)).toBeNull();
    expect(nextSpreadPage(604, 604)).toBeNull();
  });
});
