import { useMemo, useCallback } from "react";
import type { QuranPage as QuranPageType, PageHighlightMap, WordHighlight, WordSelection, QuranWord } from "@/types";
import { HIGHLIGHT_COLORS, HIGHLIGHT_BORDER_COLORS } from "@/lib/highlights";
import SurahHeader from "./SurahHeader";
import Bismillah from "./Bismillah";
import VerseMarker from "./VerseMarker";

interface QuranPageProps {
  page: QuranPageType;
  highlights: PageHighlightMap;
  activeAyah?: { surah: number; ayah: number } | null;
  onHighlightClick?: (highlight: WordHighlight) => void;
  editMode?: boolean;
  wordSelection?: WordSelection | null;
  onWordSelect?: (ayahKey: string, wordIndex1Based: number) => void;
}

interface WordWithMeta extends QuranWord {
  surah: number;
  ayah: number;
  ayahKey: string;
  wordIndex0: number; // 0-indexed position within ayah
  isAyahEnd: boolean; // last word of its ayah → verse marker follows
}

interface PageLine {
  lineNumber: number;
  words: WordWithMeta[];
  /** Short surah-final / ornamental lines are centered like the printed mushaf. */
  centered: boolean;
  /** Surah groups whose header (name + bismillah) precedes this line. */
  headers: QuranPageType["surahGroups"];
}

// Pages 1 and 2 (Al-Faatiha / start of Al-Baqara) are ornamental in the
// madani mushaf: short centered lines rather than a justified 15-line block.
const ORNAMENTAL_PAGES = new Set([1, 2]);

export default function QuranPage({
  page,
  highlights,
  activeAyah,
  onHighlightClick,
  editMode,
  wordSelection,
  onWordSelect,
}: QuranPageProps) {
  const lines = useMemo<PageLine[]>(() => {
    // Collect words line by line. A mushaf line may span ayahs, but never
    // surahs — a surah always begins under its own header row.
    const byLine = new Map<number, PageLine>();
    const getLine = (n: number): PageLine => {
      if (!byLine.has(n)) {
        byLine.set(n, { lineNumber: n, words: [], centered: false, headers: [] });
      }
      return byLine.get(n)!;
    };

    for (const group of page.surahGroups) {
      const groupLineNumbers = new Set<number>();
      for (const ayah of group.ayahs) {
        ayah.words.forEach((word, i) => {
          groupLineNumbers.add(word.lineNumber);
          getLine(word.lineNumber).words.push({
            ...word,
            surah: ayah.surah,
            ayah: ayah.ayah,
            ayahKey: `${ayah.surah}:${ayah.ayah}`,
            wordIndex0: word.position - 1,
            isAyahEnd: i === ayah.words.length - 1,
          });
        });
      }

      if (group.isSurahStart || group.bismillah) {
        const firstLine = Math.min(...groupLineNumbers);
        getLine(firstLine).headers.push(group);
      }
    }

    const sorted = [...byLine.values()].sort((a, b) => a.lineNumber - b.lineNumber);

    // Justify by default; center the visibly short lines the print centers:
    // a surah's last line on the page when it holds well under a full line's
    // worth of words. Median word count stands in for real glyph metrics
    // until the pipeline ingests the QUL mushaf-layout database.
    const counts = sorted.map((l) => l.words.length).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)] ?? 0;

    const lastLineOfGroup = new Set<number>();
    for (const group of page.surahGroups) {
      let last = 0;
      for (const ayah of group.ayahs) {
        for (const word of ayah.words) last = Math.max(last, word.lineNumber);
      }
      lastLineOfGroup.add(last);
    }

    for (const line of sorted) {
      if (ORNAMENTAL_PAGES.has(page.pageNumber)) {
        line.centered = true;
      } else if (lastLineOfGroup.has(line.lineNumber)) {
        line.centered = line.words.length < median * 0.6;
      }
    }

    return sorted;
  }, [page]);

  const handleWordClick = useCallback(
    (word: WordWithMeta) => {
      if (editMode && onWordSelect) {
        onWordSelect(word.ayahKey, word.position);
        return;
      }
      if (!onHighlightClick) return;
      const hl = highlights[word.ayahKey]?.get(word.wordIndex0);
      if (hl) {
        onHighlightClick(hl);
      }
    },
    [editMode, onWordSelect, onHighlightClick, highlights]
  );

  const isWordSelected = (word: WordWithMeta): boolean => {
    if (!wordSelection || wordSelection.ayahKey !== word.ayahKey) return false;
    const w = word.position;
    if (wordSelection.endWord === null) {
      return w === wordSelection.startWord;
    }
    return w >= wordSelection.startWord && w <= wordSelection.endWord;
  };

  const isActive = (word: WordWithMeta): boolean => {
    return activeAyah?.surah === word.surah && activeAyah?.ayah === word.ayah;
  };

  return (
    <div
      className="max-w-3xl mx-auto px-2 sm:px-6 py-6 font-arabic text-lg sm:text-2xl text-slate-100"
      dir="rtl"
    >
      {/* Page label */}
      <div className="text-center mb-4">
        <span className="text-xs font-sans text-slate-500">Page {page.pageNumber}</span>
      </div>

      <div className="space-y-1">
        {lines.map((line) => (
          <div key={`line-${line.lineNumber}`}>
            {line.headers.map((group, gIdx) => (
              <div key={`header-${group.surahIndex}-${gIdx}`}>
                {group.isSurahStart && (
                  <SurahHeader
                    surahName={group.surahName}
                    tname={group.tname}
                    surahIndex={group.surahIndex}
                  />
                )}
                {group.bismillah && <Bismillah text={group.bismillah} />}
              </div>
            ))}

            {/* One printed mushaf line: flex spreads the words edge to edge
                (CSS text-justify never justifies a block's last line, and
                every line here is one). */}
            <div
              className={`flex items-baseline flex-wrap leading-[2.1] ${
                line.centered ? "justify-center gap-x-2" : "justify-between gap-x-1"
              }`}
            >
              {line.words.map((word) => {
                const hl = highlights[word.ayahKey]?.get(word.wordIndex0);
                const highlighted = !!hl;
                const selected = editMode && isWordSelected(word);
                const clickable = editMode || highlighted;
                const active = isActive(word);

                return (
                  <span
                    key={`${word.ayahKey}:${word.position}`}
                    className="inline-flex items-baseline"
                  >
                    <span
                      className={`${
                        clickable ? "cursor-pointer" : ""
                      } ${
                        highlighted ? "rounded px-1 py-0.5" : ""
                      } ${
                        editMode ? "px-1 py-1" : ""
                      } ${
                        selected
                          ? "ring-2 ring-amber-400 rounded bg-amber-500/20"
                          : ""
                      } ${active ? "text-amber-200" : ""}`}
                      style={
                        highlighted && !selected
                          ? {
                              backgroundColor: HIGHLIGHT_COLORS[hl!.colorIndex],
                              borderBottom: `2px solid ${HIGHLIGHT_BORDER_COLORS[hl!.colorIndex]}`,
                            }
                          : undefined
                      }
                      onClick={clickable ? () => handleWordClick(word) : undefined}
                    >
                      {word.text}
                    </span>
                    {word.isAyahEnd && <VerseMarker ayahNumber={word.ayah} />}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
