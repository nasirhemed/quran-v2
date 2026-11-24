import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** The Follow strip (FollowControl), fixed over the foot of the screen while it shows. */
const STRIP = '[role="region"][aria-label="Follow mode"]';

/**
 * The height two facing pages can take: from the top of the spread to the foot of the screen, less what sits
 * below it (the page-number footer, or the Follow strip over the bottom). Measured rather than worked out from
 * 100dvh and fixed chrome budgets, so the spread fills the screen exactly whatever bars are showing (Hide's bar,
 * the Follow strip open or collapsed, a browser's own bars) and is never cut off at the bottom.
 */
export function useSpreadFit(enabled: boolean): { ref: RefObject<HTMLDivElement>; height: number | null } {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const measureRef = useRef<() => void>(() => {});
  const lastRef = useRef<number | null>(null);
  // set when the render is our own height change: that render isn't measured again. Sizing the spread changes
  // nothing above or below it, unless its top depends on its height (it did: ReaderPage's column pushed it down
  // by its own height, so every measure differed from the last, an endless render loop that crashed the reader
  // with Hide + Follow on). Skipping that one measure makes such a loop impossible.
  const ownRender = useRef(false);

  measureRef.current = () => {
    const el = ref.current;
    if (!enabled || !el) return;
    const viewport = window.visualViewport?.height ?? window.innerHeight;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const strip = document.querySelector<HTMLElement>(STRIP);
    // below the spread: the strip if it shows, else whatever follows it in the column (the footer)
    let below = strip ? strip.offsetHeight : 0;
    if (!strip) for (let n = el.nextElementSibling; n; n = n.nextElementSibling) below += (n as HTMLElement).offsetHeight;
    const h = Math.floor(viewport - top - below - 6);
    if (h === lastRef.current) return;
    lastRef.current = h;
    ownRender.current = true;
    setHeight(h);
  };

  const roRef = useRef<ResizeObserver | null>(null);
  // every render: a bar above or below may have come or gone (and the strip, opening or collapsing without the
  // reader re-rendering, is watched for size)
  useLayoutEffect(() => {
    if (ownRender.current) ownRender.current = false;
    else measureRef.current();
    const ro = roRef.current;
    if (!ro) return;
    ro.disconnect();
    document.querySelectorAll<HTMLElement>(`${STRIP}, [data-sticky-top]`).forEach((n) => ro.observe(n));
  });

  useEffect(() => {
    if (!enabled) return;
    const measure = () => measureRef.current();
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    const ro = new ResizeObserver(measure);
    roRef.current = ro;
    document.querySelectorAll<HTMLElement>(`${STRIP}, [data-sticky-top]`).forEach((n) => ro.observe(n));
    return () => {
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      ro.disconnect();
      roRef.current = null;
    };
  }, [enabled]);

  return { ref, height: enabled ? height : null };
}
