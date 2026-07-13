import type { JuzMeta, SurahMeta } from "@/types";

export function parseVerseKey(key: string): { surah: number; ayah: number } {
  const [surah, ayah] = key.split(":").map(Number);
  return { surah, ayah };
}

/**
 * Juz number (1-30) for a verse key, derived from juz-metadata.json
 * boundaries (each juz starts at {sura, aya}).
 */
export function getJuzForVerse(juzs: JuzMeta[], key: string): number {
  const { surah, ayah } = parseVerseKey(key);
  for (let i = juzs.length - 1; i >= 0; i--) {
    const j = juzs[i];
    if (surah > j.sura || (surah === j.sura && ayah >= j.aya)) {
      return j.index;
    }
  }
  return 1;
}

export function surahTname(surahs: SurahMeta[], surahIndex: number): string {
  return surahs.find((s) => s.index === surahIndex)?.tname ?? `Surah ${surahIndex}`;
}
