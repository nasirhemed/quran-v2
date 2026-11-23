import { useCallback, useEffect, useState } from "react";

export type SpreadMode = "auto" | "single" | "dual";

const STORAGE_KEY = "reader-spread-mode";

function loadSpreadMode(): SpreadMode {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val === "single" || val === "dual" || val === "auto") return val;
  } catch {
    // Private mode fallback
  }
  return "auto";
}

/**
 * Checks whether the screen/viewport is large enough to comfortably render two Mushaf pages side by side:
 * - Unfolded dual-screen or foldable devices (CSS viewport segments or single-fold-vertical).
 * - Foldable screens with squarish/landscape inner displays (e.g. 988x1024, 750x900).
 * - Tablets (e.g. iPad in portrait 768x1024, landscape 1024x768).
 * - Laptops / desktops (>= 1000px).
 *
 * Excludes phones in portrait (width < 700) and phones in landscape (height < 500).
 */
export function canSupportDualPage(): boolean {
  if (typeof window === "undefined") return false;

  // 1. Foldable / dual-screen spanning media features
  const isFoldableSpanning =
    (window.matchMedia &&
      (window.matchMedia("(horizontal-viewport-segments: 2)").matches ||
        window.matchMedia("(spanning: single-fold-vertical)").matches)) ||
    false;
  if (isFoldableSpanning) return true;

  // 2. Viewport dimensions & aspect ratio
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Mushaf requires ~500px vertical space to fit 15 lines without crushing
  if (h < 500) return false;

  // Width >= 700 with squarish/landscape aspect ratio (>= 0.75), or wide screens >= 1000px
  return (w >= 700 && w / h >= 0.75) || w >= 1000;
}

export function useDualPageMode() {
  const [spreadMode, setSpreadModeState] = useState<SpreadMode>(loadSpreadMode);
  const [supported, setSupported] = useState<boolean>(canSupportDualPage);

  useEffect(() => {
    function updateSupport() {
      setSupported(canSupportDualPage());
    }

    updateSupport();
    window.addEventListener("resize", updateSupport);

    const mql = window.matchMedia?.("(horizontal-viewport-segments: 2)");
    mql?.addEventListener?.("change", updateSupport);

    return () => {
      window.removeEventListener("resize", updateSupport);
      mql?.removeEventListener?.("change", updateSupport);
    };
  }, []);

  const setSpreadMode = useCallback((mode: SpreadMode) => {
    setSpreadModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // Private mode
    }
  }, []);

  const isDualPage =
    spreadMode === "single"
      ? false
      : spreadMode === "dual"
        ? true
        : supported;

  const toggleSpreadMode = useCallback(() => {
    setSpreadMode(isDualPage ? "single" : "dual");
  }, [isDualPage, setSpreadMode]);

  return {
    isDualPage,
    spreadMode,
    canSupportDualPage: supported,
    setSpreadMode,
    toggleSpreadMode,
  };
}
