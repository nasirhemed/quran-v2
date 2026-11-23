/**
 * Two facing pages, as a printed mushaf opens: the odd page on the right, the next (even) page on its left, so
 * 1|2, 3|4 … 603|604 (both Madinah prints have 604 pages). Plain TS, tested in tests/mushaf/spread.test.ts.
 */
export interface Spread {
  /** the right-hand page, read first (odd) */
  right: number;
  /** the left-hand page, or null past the last page */
  left: number | null;
}

/** The spread that holds `page`. */
export function spreadOf(page: number, pageCount: number): Spread {
  const right = page % 2 === 1 ? page : page - 1;
  return { right, left: right + 1 <= pageCount ? right + 1 : null };
}

/** The page to go to for the next spread (its right-hand page), or null on the last one. */
export function nextSpreadPage(page: number, pageCount: number): number | null {
  const next = spreadOf(page, pageCount).right + 2;
  return next <= pageCount ? next : null;
}

/** The page to go to for the previous spread (its right-hand page), or null on the first one. */
export function prevSpreadPage(page: number, pageCount: number): number | null {
  const prev = spreadOf(page, pageCount).right - 2;
  return prev >= 1 ? prev : null;
}
