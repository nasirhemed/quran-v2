import { useEffect, useState } from "react";
import { mushafFonts } from "@/lib/mushaf/fontStore";
import { PAGE_COUNT, pageFontFamily, pageFontFile, surahNamesFamily, SURAH_NAMES_FILE, type MushafPack } from "@/lib/mushaf/pack";
import { useMushafLayout } from "@/hooks/useMushafLayout";

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

function fontsFor(pack: MushafPack, page: number, opts: { headers: boolean; bismillah: boolean }): Need[] {
  const list: Need[] = [{ file: pageFontFile(page), family: pageFontFamily(page, pack) }];
  if (opts.headers) list.push({ file: SURAH_NAMES_FILE, family: surahNamesFamily(pack), pin: true });
  if (opts.bismillah && page !== BISMILLAH_PAGE) {
    list.push({ file: pageFontFile(BISMILLAH_PAGE), family: pageFontFamily(BISMILLAH_PAGE, pack), pin: true });
  }
  return list;
}

/**
 * Loads what a page of `pack`'s print needs to be drawn from glyphs, then quietly loads the pages either side
 * (`around` of them each way: 2 in a two-page spread).
 */
export function useMushafFonts(
  pack: MushafPack,
  page: number,
  opts: { headers: boolean; bismillah: boolean; around?: number }
): MushafFontState {
  const fonts = mushafFonts(pack);
  const list = fontsFor(pack, page, opts);
  const key = list.map((n) => n.family).join(",");
  const allReady = () => list.every((n) => fonts.isReady(n.family));
  const [state, setState] = useState<{ key: string; state: MushafFontState }>(() => ({
    key,
    state: allReady() ? "ready" : "loading",
  }));

  useEffect(() => {
    let live = true;
    const neighbours = () => {
      const around = opts.around ?? 1;
      for (let d = 1; d <= around; d++) {
        for (const p of [page + d, page - d]) {
          if (p >= 1 && p <= PAGE_COUNT) void fonts.load(pageFontFile(p), pageFontFamily(p, pack));
        }
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
 * The chosen print's surah-name font, for names drawn outside a page (surah lists, titles): its family once it can
 * draw, else null. It is the same pinned file the page headers use, so it is fetched once and then comes from the
 * device.
 */
export function useSurahNamesFont(): string | null {
  const { pack } = useMushafLayout();
  const fonts = mushafFonts(pack);
  const family = surahNamesFamily(pack);
  const [ready, setReady] = useState<string | null>(() => (fonts.isReady(family) ? family : null));
  useEffect(() => {
    if (fonts.isReady(family)) {
      setReady(family);
      return;
    }
    let live = true;
    void fonts.load(SURAH_NAMES_FILE, family, { pin: true }).then((ok) => live && ok && setReady(family));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [family]);
  return ready === family ? ready : null;
}
