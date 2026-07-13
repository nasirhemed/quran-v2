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
}

export default function QuranPage({
  page,
  highlights,
  activeAyah,
  onHighlightClick,
  editMode,
  wordSelection,
  onWordSelect,
}: QuranPageProps) {
  // Collect all words with metadata and group by line number
  const lineGroups = useMemo(() => {
    const allWords: WordWithMeta[] = [];

    for (const group of page.surahGroups) {
      for (const ayah of group.ayahs) {
        for (const word of ayah.words) {
          allWords.push({
            ...word,
            surah: ayah.surah,
            ayah: ayah.ayah,
            ayahKey: `${ayah.surah}:${ayah.ayah}`,
            wordIndex0: word.position - 1,
          });
        }
      }
    }

    // Group by line number
    const groups = new Map<number, WordWithMeta[]>();
    for (const word of allWords) {
      if (!groups.has(word.lineNumber)) {
        groups.set(word.lineNumber, []);
      }
      groups.get(word.lineNumber)!.push(word);
    }

    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [page]);

  // Map line numbers to surah headers that should appear before them
  const headersByLine = useMemo(() => {
    const headers = new Map<number, typeof page.surahGroups>();
    for (const group of page.surahGroups) {
      if (!group.isSurahStart && !group.bismillah) continue;
      // Find the first line number for this group
      const firstWord = group.ayahs[0]?.words[0];
      if (!firstWord) continue;
      const lineNum = firstWord.lineNumber;
      if (!headers.has(lineNum)) {
        headers.set(lineNum, []);
      }
      headers.get(lineNum)!.push(group);
    }
    return headers;
  }, [page]);

  // Track verse markers - we need to show marker after the last word of each ayah
  const verseMarkers = useMemo(() => {
    const markers = new Map<string, number>(); // key: "lineNum-wordIdx", value: ayahNumber

    for (const group of page.surahGroups) {
      for (const ayah of group.ayahs) {
        if (ayah.words.length > 0) {
          const lastWord = ayah.words[ayah.words.length - 1];
          const key = `${lastWord.lineNumber}-${ayah.surah}-${ayah.ayah}-${lastWord.position}`;
          markers.set(key, ayah.ayah);
        }
      }
    }

    return markers;
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
      className="max-w-3xl mx-auto px-2 sm:px-4 py-6 font-arabic text-lg sm:text-2xl leading-loose text-slate-100"
      dir="rtl"
    >
      {/* Page label */}
      <div className="text-center mb-4">
        <span className="text-xs font-sans text-slate-500">Page {page.pageNumber}</span>
      </div>

      {/* Render lines with interleaved surah headers */}
      <div className="text-justify">
        {lineGroups.map(([lineNum, lineWords]) => (
          <div key={`line-${lineNum}`}>
            {headersByLine.get(lineNum)?.map((group, gIdx) => (
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
            <div className="leading-loose">
            {lineWords.map((word, wordIdx) => {
              const hl = highlights[word.ayahKey]?.get(word.wordIndex0);
              const highlighted = !!hl;
              const selected = editMode && isWordSelected(word);
              const clickable = editMode || highlighted;
              const isLastWordInLine = wordIdx === lineWords.length - 1;
              const active = isActive(word);
              const markerKey = `${word.lineNumber}-${word.surah}-${word.ayah}-${word.position}`;
              const showMarker = verseMarkers.has(markerKey);

              return (
                <span key={`${word.ayahKey}:${word.position}`}>
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
                  {showMarker && <VerseMarker ayahNumber={word.ayah} />}
                  {!isLastWordInLine && " "}
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
