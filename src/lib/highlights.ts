import type {
  AyahHighlights,
  HighlightEntry,
  PageHighlightMap,
  QuranPage,
  WordHighlight,
} from "@/types";

// 8-color palette (blue, emerald, amber, red, purple, pink, cyan, lime).
// Actual colors live in src/index.css as --hl-N-bg/--hl-N-bd so each theme
// gets its own alpha tuning.
export const HIGHLIGHT_COLORS = Array.from(
  { length: 8 },
  (_, i) => `var(--hl-${i}-bg)`
);

export const HIGHLIGHT_BORDER_COLORS = Array.from(
  { length: 8 },
  (_, i) => `var(--hl-${i}-bd)`
);

export function computePageHighlights(
  page: QuranPage,
  ayahHighlights: AyahHighlights
): PageHighlightMap {
  const result: PageHighlightMap = {};

  // Collect all unique highlight IDs on this page to assign colors
  const uniqueIds = new Set<string>();
  for (const group of page.surahGroups) {
    for (const ayah of group.ayahs) {
      const key = `${ayah.surah}:${ayah.ayah}`;
      const entries = ayahHighlights[key];
      if (entries) {
        for (const e of entries) {
          uniqueIds.add(`${e.type}:${e.id}`);
        }
      }
    }
  }

  // Assign colors round-robin
  const colorMap = new Map<string, number>();
  let colorIdx = 0;
  for (const uid of uniqueIds) {
    colorMap.set(uid, colorIdx % HIGHLIGHT_COLORS.length);
    colorIdx++;
  }

  // Build per-word highlight map
  for (const group of page.surahGroups) {
    for (const ayah of group.ayahs) {
      const key = `${ayah.surah}:${ayah.ayah}`;
      const entries = ayahHighlights[key];
      if (!entries) continue;

      const wordMap = new Map<number, WordHighlight>();
      const wordCount = ayah.words.length;

      // Sort entries: prefer phrase highlights over similar (more specific),
      // and prefer entries with smaller total word coverage (rarer = more interesting)
      const sorted = [...entries].sort((a, b) => {
        if (a.type !== b.type) return a.type === "phrase" ? -1 : 1;
        const aSize = totalRangeSize(a);
        const bSize = totalRangeSize(b);
        return aSize - bSize;
      });

      // Apply highlights - later entries don't override earlier (rarer wins)
      for (const entry of sorted) {
        const uid = `${entry.type}:${entry.id}`;
        const ci = colorMap.get(uid) ?? 0;
        for (const [start, end] of entry.wordRanges) {
          for (let i = start - 1; i <= end - 1 && i < wordCount; i++) {
            if (!wordMap.has(i)) {
              wordMap.set(i, {
                type: entry.type,
                id: entry.id,
                colorIndex: ci,
              });
            }
          }
        }
      }

      if (wordMap.size > 0) {
        result[key] = wordMap;
      }
    }
  }

  return result;
}

export function mergeHighlights(
  base: AyahHighlights,
  local: AyahHighlights
): AyahHighlights {
  const result: AyahHighlights = { ...base };
  for (const key of Object.keys(local)) {
    result[key] = [...(result[key] ?? []), ...local[key]];
  }
  return result;
}

function totalRangeSize(entry: HighlightEntry): number {
  let total = 0;
  for (const [s, e] of entry.wordRanges) {
    total += e - s + 1;
  }
  return total;
}
