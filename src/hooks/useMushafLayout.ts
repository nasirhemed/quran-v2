import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMushafPages } from "@/lib/data";
import { DEFAULT_LAYOUT, isLayoutId, MUSHAF_LAYOUTS, type MushafLayoutDef, type MushafLayoutId } from "@/lib/mushaf/layouts";

/** The chosen print, remembered in localStorage "mushafLayout" (Settings → Mushaf). */
const KEY = "mushafLayout";
const listeners = new Set<() => void>();

function read(): MushafLayoutId {
  try {
    const v = localStorage.getItem(KEY);
    return isLayoutId(v) ? v : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

let current: MushafLayoutId = typeof localStorage === "undefined" ? DEFAULT_LAYOUT : read();

export function setMushafLayout(id: MushafLayoutId) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // storage blocked: the choice holds for this visit
  }
  current = id;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  // another tab changed it
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

/** The print the reader draws. */
export function useMushafLayout(): MushafLayoutDef {
  const id = useSyncExternalStore(subscribe, () => current, () => DEFAULT_LAYOUT);
  return MUSHAF_LAYOUTS[id];
}

/**
 * The chosen print's pages. If its layout file can't be had (not deployed yet, or offline before it was ever
 * cached), the reader falls back to the 1421H pages rather than showing nothing; `fallback` says so.
 */
export function useMushafPages() {
  const layout = useMushafLayout();
  const chosen = useQuery({ queryKey: ["mushaf-pages", layout.id], queryFn: () => fetchMushafPages(layout.id), retry: 1 });
  const base = useQuery({
    queryKey: ["mushaf-pages", "1421"],
    queryFn: () => fetchMushafPages("1421"),
    enabled: !!chosen.error,
  });
  const data = chosen.data ?? (chosen.error ? base.data : undefined);
  return { data, isLoading: !data && !chosen.error && !base.error, fallback: !!chosen.error, error: chosen.error && base.error };
}
