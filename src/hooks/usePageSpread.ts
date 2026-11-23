import { useSyncExternalStore } from "react";

/**
 * Two facing pages on a wide screen (a tablet held sideways, an unfolded foldable, a desktop), one page otherwise.
 * "auto" shows two whenever the screen is wide enough; "one" always shows one. Remembered in localStorage
 * "pageSpread" (Settings → Mushaf layout).
 */
export type PageSpreadSetting = "auto" | "one";

const KEY = "pageSpread";
const listeners = new Set<() => void>();

/**
 * Wide enough for two pages side by side at a comfortable size: a single page is sized to the screen's height
 * (about 0.6 × its height), so two fit beside each other once the screen is about as wide as it is tall. Phones
 * turned sideways are too short (below 581 px the reader scrolls a single page) and stay on one.
 */
export const SPREAD_QUERY = "(min-width: 720px) and (min-height: 581px) and (min-aspect-ratio: 9/10)";

function read(): PageSpreadSetting {
  try {
    return localStorage.getItem(KEY) === "one" ? "one" : "auto";
  } catch {
    return "auto";
  }
}

let current: PageSpreadSetting = typeof localStorage === "undefined" ? "auto" : read();

export function setPageSpread(v: PageSpreadSetting) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // storage blocked: the choice holds for this visit
  }
  current = v;
  listeners.forEach((l) => l());
}

function subscribeSetting(l: () => void) {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    current = read();
    l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function usePageSpreadSetting(): PageSpreadSetting {
  return useSyncExternalStore(subscribeSetting, () => current, () => "auto");
}

function subscribeWide(l: () => void) {
  const mq = window.matchMedia(SPREAD_QUERY);
  mq.addEventListener("change", l);
  return () => mq.removeEventListener("change", l);
}

/** Show two pages now? (Follows the screen as it rotates, folds or resizes.) */
export function usePageSpread(): boolean {
  const setting = usePageSpreadSetting();
  const wide = useSyncExternalStore(
    subscribeWide,
    () => typeof window.matchMedia === "function" && window.matchMedia(SPREAD_QUERY).matches,
    () => false
  );
  return setting === "auto" && wide;
}
