/**
 * Two-page spread logic for the standard 15-line Madinah Mushaf (604 pages).
 *
 * In an Arabic RTL codex, pages are read from right to left:
 * - The right page is the earlier page (odd numbers: 1, 3, 5, ..., 603).
 * - The left page is the facing later page (even numbers: 2, 4, 6, ..., 604).
 *
 * For example, Page 1 (Al-Fatihah) faces Page 2 (Al-Baqarah 1-5);
 * Page 3 faces Page 4; and Page 603 faces Page 604 (Al-Falaq & An-Nas).
 */

export interface PageSpread {
  rightPageNumber: number;
  leftPageNumber: number;
}

export const TOTAL_PAGES = 604;

/**
 * Returns the two facing pages for any given page number.
 */
export function getSpreadForPage(pageNumber: number): PageSpread {
  const clamped = Math.max(1, Math.min(TOTAL_PAGES, Math.round(pageNumber) || 1));
  const isOdd = clamped % 2 === 1;
  const rightPageNumber = isOdd ? clamped : clamped - 1;
  const leftPageNumber = Math.min(TOTAL_PAGES, rightPageNumber + 1);
  return { rightPageNumber, leftPageNumber };
}

/**
 * Returns the target page number to navigate forward by one spread (2 pages).
 */
export function getNextSpreadPage(currentPage: number): number {
  const spread = getSpreadForPage(currentPage);
  return Math.min(TOTAL_PAGES, spread.rightPageNumber + 2);
}

/**
 * Returns the target page number to navigate backward by one spread (2 pages).
 */
export function getPrevSpreadPage(currentPage: number): number {
  const spread = getSpreadForPage(currentPage);
  return Math.max(1, spread.rightPageNumber - 2);
}

/**
 * Determines whether `targetPage` is already visible in the spread containing `currentSpreadPage`.
 */
export function isPageInSpread(targetPage: number, currentSpreadPage: number): boolean {
  const spread = getSpreadForPage(currentSpreadPage);
  return targetPage === spread.rightPageNumber || targetPage === spread.leftPageNumber;
}
