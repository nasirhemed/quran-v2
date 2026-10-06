import { useEffect, useState } from "react";
import { mushafFonts } from "@/lib/mushaf/fontStore";
import { PAGE_COUNT, pageFontFamily, pageFontFile, SURAH_NAMES_FAMILY, SURAH_NAMES_FILE } from "@/lib/mushaf/pack";

/**
 * ready: draw the page's glyphs. loading: the fonts are on their way (draw nothing yet). slow: still on their way
 * after a while, so draw the text instead meanwhile. failed: no fonts (offline and not stored, or not hosted):
 * draw the text.
 */
export type MushafFontState = "ready" | "loading" | "slow" | "failed";

/** The bismillah line is drawn with page 1's glyphs for 1:1 words 1–4, so it needs page 1's font. */
export const BISMILLAH_PAGE = 1;

const SLOW_MS = 2500;

interface Need {
  file: string;
  family: string;
  pin?: boolean;
}

function fontsFor(page: number, opts: { headers: boolean; bismillah: boolean }): Need[] {
  const list: Need[] = [{ file: pageFontFile(page), family: pageFontFamily(page) }];
  if (opts.headers) list.push({ file: SURAH_NAMES_FILE, family: SURAH_NAMES_FAMILY, pin: true });
  if (opts.bismillah && page !== BISMILLAH_PAGE) {
    list.push({ file: pageFontFile(BISMILLAH_PAGE), family: pageFontFamily(BISMILLAH_PAGE), pin: true });
  }
  return list;
}

/** Loads what a page needs to be drawn from glyphs, then quietly loads the pages either side. */
export function useMushafFonts(page: number, opts: { headers: boolean; bismillah: boolean }): MushafFontState {
  const fonts = mushafFonts();
  const list = fontsFor(page, opts);
  const key = list.map((n) => n.family).join(",");
  const allReady = () => list.every((n) => fonts.isReady(n.family));
  const [state, setState] = useState<{ key: string; state: MushafFontState }>(() => ({
    key,
    state: allReady() ? "ready" : "loading",
  }));

  useEffect(() => {
    let live = true;
    const neighbours = () => {
      for (const p of [page + 1, page - 1]) {
        if (p >= 1 && p <= PAGE_COUNT) void fonts.load(pageFontFile(p), pageFontFamily(p));
      }
    };
    if (allReady()) {
      setState({ key, state: "ready" });
      neighbours();
      return;
    }
    setState({ key, state: "loading" });
    const slow = setTimeout(() => {
      if (live) setState((s) => (s.key === key && s.state === "loading" ? { key, state: "slow" } : s));
    }, SLOW_MS);
    Promise.all(list.map((n) => fonts.load(n.file, n.family, { pin: n.pin }))).then((ok) => {
      if (!live) return;
      const ready = ok.every(Boolean);
      setState({ key, state: ready ? "ready" : "failed" });
      if (ready) neighbours();
    });
    return () => {
      live = false;
      clearTimeout(slow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // A new page whose fonts are already registered draws at once, before the effect runs.
  if (state.key !== key) return allReady() ? "ready" : "loading";
  return state.state;
}

/**
 * The mushaf's surah-name font, for names drawn outside a page (surah lists, titles): true once it can draw.
 * It is the same pinned file the page headers use, so it is fetched once and then comes from the device.
 */
export function useSurahNamesFont(): boolean {
  const fonts = mushafFonts();
  const [ready, setReady] = useState(() => fonts.isReady(SURAH_NAMES_FAMILY));
  useEffect(() => {
    if (ready) return;
    let live = true;
    void fonts.load(SURAH_NAMES_FILE, SURAH_NAMES_FAMILY, { pin: true }).then((ok) => live && ok && setReady(true));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ready;
}
