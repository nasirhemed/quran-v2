import { useCallback, useMemo } from "react";
import { HIGHLIGHT_COLORS, HIGHLIGHT_BORDER_COLORS } from "@/lib/highlights";
import type { WordHighlight, WordSelection, QuranWord } from "@/types";
import VerseMarker from "./VerseMarker";

interface AyahTextProps {
  surah: number;
  ayah: number;
  words: QuranWord[];
  highlights?: Map<number, WordHighlight>;
  isActive?: boolean;
  onHighlightClick?: (highlight: WordHighlight) => void;
  editMode?: boolean;
  wordSelection?: WordSelection | null;
  onWordSelect?: (ayahKey: string, wordIndex1Based: number) => void;
}

export default function AyahText({
  surah,
  ayah,
  words,
  highlights,
  isActive,
  onHighlightClick,
  editMode,
  wordSelection,
  onWordSelect,
}: AyahTextProps) {
  const ayahKey = `${surah}:${ayah}`;

  // Group words by line number
  const lineGroups = useMemo(() => {
    const groups = new Map<number, QuranWord[]>();
    for (const word of words) {
      if (!groups.has(word.lineNumber)) {
        groups.set(word.lineNumber, []);
      }
      groups.get(word.lineNumber)!.push(word);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a - b);
  }, [words]);

  const handleWordClick = useCallback(
    (wordIndex: number) => {
      if (editMode && onWordSelect) {
        onWordSelect(ayahKey, wordIndex + 1); // convert to 1-indexed
        return;
      }
      if (!highlights || !onHighlightClick) return;
      const hl = highlights.get(wordIndex);
      if (hl) {
        onHighlightClick(hl);
      }
    },
    [editMode, onWordSelect, ayahKey, highlights, onHighlightClick]
  );

  const isWordSelected = (wordIndex0: number): boolean => {
    if (!wordSelection || wordSelection.ayahKey !== ayahKey) return false;
    const w = wordIndex0 + 1; // 1-indexed
    if (wordSelection.endWord === null) {
      return w === wordSelection.startWord;
    }
    return w >= wordSelection.startWord && w <= wordSelection.endWord;
  };

  return (
    <>
      {lineGroups.map(([lineNum, lineWords]) => (
        <div key={`${ayahKey}-line-${lineNum}`} className="leading-loose">
          {lineWords.map((word, wordIdx) => {
            const wordIndex0 = word.position - 1; // Convert 1-indexed to 0-indexed
            const hl = highlights?.get(wordIndex0);
            const highlighted = !!hl;
            const selected = editMode && isWordSelected(wordIndex0);
            const clickable = editMode || highlighted;
            const isLastWordInLine = wordIdx === lineWords.length - 1;

            return (
              <span key={`${ayahKey}:${word.position}`}>
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
                  } ${isActive ? "text-amber-200" : ""}`}
                  style={
                    highlighted && !selected
                      ? {
                          backgroundColor: HIGHLIGHT_COLORS[hl!.colorIndex],
                          borderBottom: `2px solid ${HIGHLIGHT_BORDER_COLORS[hl!.colorIndex]}`,
                        }
                      : undefined
                  }
                  onClick={clickable ? () => handleWordClick(wordIndex0) : undefined}
                >
                  {word.text}
                </span>
                {!isLastWordInLine && " "}
              </span>
            );
          })}
        </div>
      ))}
      <VerseMarker ayahNumber={ayah} />
    </>
  );
}
