import { beforeEach, describe, expect, it } from "vitest";
import {
  ayahCopyText,
  ayahLink,
  isBookmarked,
  loadBookmarks,
  parseAyahRef,
  toggleBookmark,
} from "@/lib/ayahActions";
import type { PageAyah } from "@/types";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  };
});

describe("the ayah menu", () => {
  it("finds the verse from a word's or an ornament's key", () => {
    expect(parseAyahRef("2:255:3")).toEqual({ surah: 2, ayah: 255 });
    expect(parseAyahRef("112:4")).toEqual({ surah: 112, ayah: 4 });
    expect(parseAyahRef("115:1")).toBeNull();
    expect(parseAyahRef("0:1")).toBeNull();
    expect(parseAyahRef("")).toBeNull();
    expect(parseAyahRef(undefined)).toBeNull();
    expect(parseAyahRef("end-2:3")).toBeNull();
  });

  it("copies the verse's text with its number and where it is from", () => {
    const word = (text: string, position: number) => ({ text, hafs: text, glyph: "", lineNumber: 1, position });
    const ayah: PageAyah = {
      surah: 112,
      ayah: 1,
      words: [word("قُلْ", 1), word("هُوَ", 2), word("ٱللَّهُ", 3), word("أَحَدٌ", 4)],
      end: { glyph: "", lineNumber: 1 },
    };
    expect(ayahCopyText(ayah, "Al-Ikhlaas")).toBe("قُلْ هُوَ ٱللَّهُ أَحَدٌ (١)\n— Al-Ikhlaas 112:1");
    expect(ayahLink("https://example.app", { surah: 112, ayah: 1 })).toBe("https://example.app/read?surah=112&ayah=1");
  });

  it("bookmarks a verse and takes it out again, newest first, and remembers them", () => {
    const a = { surah: 2, ayah: 255, page: 42, tname: "Al-Baqara" };
    const b = { surah: 18, ayah: 10, page: 294, tname: "Al-Kahf" };
    let list = toggleBookmark([], a, 1);
    list = toggleBookmark(list, b, 2);
    expect(list.map((x) => x.ayah)).toEqual([10, 255]);
    expect(isBookmarked(list, { surah: 2, ayah: 255 })).toBe(true);
    expect(loadBookmarks()).toEqual(list);
    list = toggleBookmark(list, a, 3);
    expect(isBookmarked(list, a)).toBe(false);
    expect(loadBookmarks().map((x) => x.ayah)).toEqual([10]);
  });

  it("ignores bad stored bookmarks", () => {
    store.set("bookmarks", "{not json");
    expect(loadBookmarks()).toEqual([]);
    store.set("bookmarks", JSON.stringify([{ surah: 1 }, { surah: 1, ayah: 1, page: 1, tname: "Al-Faatiha", at: 0 }]));
    expect(loadBookmarks()).toHaveLength(1);
  });
});
