import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getSpreadForPage,
  getNextSpreadPage,
  getPrevSpreadPage,
  isPageInSpread,
} from "@/lib/mushaf/spread";

describe("Mushaf spread helpers", () => {
  it("maps pages 1 and 2 to the opening spread (1 on right, 2 on left)", () => {
    expect(getSpreadForPage(1)).toEqual({ rightPageNumber: 1, leftPageNumber: 2 });
    expect(getSpreadForPage(2)).toEqual({ rightPageNumber: 1, leftPageNumber: 2 });
  });

  it("maps pages 3 and 4 to spread [3, 4]", () => {
    expect(getSpreadForPage(3)).toEqual({ rightPageNumber: 3, leftPageNumber: 4 });
    expect(getSpreadForPage(4)).toEqual({ rightPageNumber: 3, leftPageNumber: 4 });
  });

  it("maps the final pages 603 and 604 to spread [603, 604]", () => {
    expect(getSpreadForPage(603)).toEqual({ rightPageNumber: 603, leftPageNumber: 604 });
    expect(getSpreadForPage(604)).toEqual({ rightPageNumber: 603, leftPageNumber: 604 });
  });

  it("clamps out-of-bounds page numbers", () => {
    expect(getSpreadForPage(-5)).toEqual({ rightPageNumber: 1, leftPageNumber: 2 });
    expect(getSpreadForPage(999)).toEqual({ rightPageNumber: 603, leftPageNumber: 604 });
  });

  it("navigates forward by spreads", () => {
    expect(getNextSpreadPage(1)).toBe(3);
    expect(getNextSpreadPage(2)).toBe(3);
    expect(getNextSpreadPage(3)).toBe(5);
    expect(getNextSpreadPage(4)).toBe(5);
    expect(getNextSpreadPage(603)).toBe(604); // or clamped to 604
    expect(getNextSpreadPage(604)).toBe(604);
  });

  it("navigates backward by spreads", () => {
    expect(getPrevSpreadPage(1)).toBe(1);
    expect(getPrevSpreadPage(2)).toBe(1);
    expect(getPrevSpreadPage(3)).toBe(1);
    expect(getPrevSpreadPage(4)).toBe(1);
    expect(getPrevSpreadPage(5)).toBe(3);
    expect(getPrevSpreadPage(604)).toBe(601);
  });

  it("checks whether a page is within a spread", () => {
    expect(isPageInSpread(3, 4)).toBe(true);
    expect(isPageInSpread(4, 3)).toBe(true);
    expect(isPageInSpread(5, 4)).toBe(false);
    expect(isPageInSpread(1, 2)).toBe(true);
    expect(isPageInSpread(2, 1)).toBe(true);
  });
});

describe("canSupportDualPage detection", () => {
  it("returns false in node environment when window is undefined", async () => {
    const { canSupportDualPage } = await import("@/hooks/useDualPageMode");
    expect(canSupportDualPage()).toBe(false);
  });

  describe("with mock window", () => {
    beforeEach(() => {
      (globalThis as unknown as { window: unknown }).window = {
        innerWidth: 1024,
        innerHeight: 768,
        matchMedia: () => ({ matches: false }),
      };
    });

    afterEach(() => {
      delete (globalThis as unknown as { window?: unknown }).window;
    });

    it("detects foldable inner display (988x1024, as in user attachment)", async () => {
      const { canSupportDualPage } = await import("@/hooks/useDualPageMode");
      (window as unknown as { innerWidth: number; innerHeight: number }).innerWidth = 988;
      (window as unknown as { innerWidth: number; innerHeight: number }).innerHeight = 1024;
      expect(canSupportDualPage()).toBe(true);
    });

    it("rejects narrow mobile portrait (390x844)", async () => {
      const { canSupportDualPage } = await import("@/hooks/useDualPageMode");
      (window as unknown as { innerWidth: number; innerHeight: number }).innerWidth = 390;
      (window as unknown as { innerWidth: number; innerHeight: number }).innerHeight = 844;
      expect(canSupportDualPage()).toBe(false);
    });

    it("rejects phone landscape with insufficient height (844x390)", async () => {
      const { canSupportDualPage } = await import("@/hooks/useDualPageMode");
      (window as unknown as { innerWidth: number; innerHeight: number }).innerWidth = 844;
      (window as unknown as { innerWidth: number; innerHeight: number }).innerHeight = 390;
      expect(canSupportDualPage()).toBe(false);
    });

    it("accepts iPad / tablet portrait (768x1024, ratio >= 0.75)", async () => {
      const { canSupportDualPage } = await import("@/hooks/useDualPageMode");
      (window as unknown as { innerWidth: number; innerHeight: number }).innerWidth = 768;
      (window as unknown as { innerWidth: number; innerHeight: number }).innerHeight = 1024;
      expect(canSupportDualPage()).toBe(true);
    });

    it("accepts wide screens / desktop (>= 1000px)", async () => {
      const { canSupportDualPage } = await import("@/hooks/useDualPageMode");
      (window as unknown as { innerWidth: number; innerHeight: number }).innerWidth = 1280;
      (window as unknown as { innerWidth: number; innerHeight: number }).innerHeight = 800;
      expect(canSupportDualPage()).toBe(true);
    });

    it("detects dual-screen horizontal viewport segments", async () => {
      const { canSupportDualPage } = await import("@/hooks/useDualPageMode");
      (window as unknown as { innerWidth: number; innerHeight: number }).innerWidth = 600;
      (window as unknown as { innerWidth: number; innerHeight: number }).innerHeight = 600;
      (window as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = (query: string) => ({
        matches: query.includes("horizontal-viewport-segments: 2"),
      });
      expect(canSupportDualPage()).toBe(true);
    });
  });
});
