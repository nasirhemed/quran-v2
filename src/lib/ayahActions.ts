/**
 * What the reader's ayah menu does (components/page/AyahMenu.tsx; a still long press on a verse opens it, so
 * pages never select text under a finger and a press never fights a swipe). Plain TS, tested in
 * tests/mushaf/ayah-actions.test.ts.
 */
import type { PageAyah } from "@/types";
import { ayahNumberText } from "@/lib/mushaf/layout";

export interface AyahRef {
  surah: number;
  ayah: number;
}

/** The verse a page element belongs to: a word's `data-w` ("s:a:w") or an ornament's `data-a` ("s:a"). */
export function parseAyahRef(key: string | undefined | null): AyahRef | null {
  if (!key) return null;
  const m = /^(\d{1,3}):(\d{1,3})(?::\d+)?$/.exec(key);
  if (!m) return null;
  const surah = Number(m[1]);
  const ayah = Number(m[2]);
  return surah >= 1 && surah <= 114 && ayah >= 1 ? { surah, ayah } : null;
}

/** The verse's Uthmani text with its number ornament, and where it is from: what Copy and Share give. */
export function ayahCopyText(ayah: PageAyah, tname: string): string {
  const text = ayah.words.map((w) => w.text).join(" ");
  return `${text} ${ayahNumberText(ayah.ayah)}\n— ${tname} ${ayah.surah}:${ayah.ayah}`;
}

/** A link that opens the reader on the verse. */
export function ayahLink(origin: string, ref: AyahRef): string {
  return `${origin}/read?surah=${ref.surah}&ayah=${ref.ayah}`;
}

// ─── Bookmarks (localStorage "bookmarks", newest first) ─────────

export interface Bookmark extends AyahRef {
  page: number;
  tname: string;
  /** when it was saved, ms since the epoch */
  at: number;
}

const KEY = "bookmarks";

const valid = (b: unknown): b is Bookmark => {
  const x = b as Bookmark;
  return (
    !!x &&
    Number.isInteger(x.surah) &&
    Number.isInteger(x.ayah) &&
    Number.isInteger(x.page) &&
    typeof x.tname === "string" &&
    typeof x.at === "number"
  );
};

export function loadBookmarks(): Bookmark[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(valid) : [];
  } catch {
    return [];
  }
}

function saveBookmarks(list: Bookmark[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}

export const sameAyah = (a: AyahRef, b: AyahRef) => a.surah === b.surah && a.ayah === b.ayah;

export function isBookmarked(list: readonly Bookmark[], ref: AyahRef): boolean {
  return list.some((b) => sameAyah(b, ref));
}

/** Adds the verse (at the front) or takes it out; returns the new list, which is also saved. */
export function toggleBookmark(list: readonly Bookmark[], entry: Omit<Bookmark, "at">, now = Date.now()): Bookmark[] {
  const next = isBookmarked(list, entry)
    ? list.filter((b) => !sameAyah(b, entry))
    : [{ ...entry, at: now }, ...list];
  saveBookmarks(next);
  return next;
}
