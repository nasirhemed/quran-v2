import type { SurahMeta } from "@/types";

export function parseVerseKey(key: string): { surah: number; ayah: number } {
  const [surah, ayah] = key.split(":").map(Number);
  return { surah, ayah };
}

export function surahTname(surahs: SurahMeta[], surahIndex: number): string {
  return surahs.find((s) => s.index === surahIndex)?.tname ?? `Surah ${surahIndex}`;
}
