import { useState, useCallback } from "react";
import type { QuranWord } from "@/types";

interface SelectableVerseProps {
  words: QuranWord[];
  ayahKey: string;
  selectedRange?: [number, number] | null; // 1-indexed
  onRangeSelected: (startWord: number, endWord: number) => void;
}

export default function SelectableVerse({
  words,
  ayahKey,
  selectedRange,
  onRangeSelected,
}: SelectableVerseProps) {
  const [firstClick, setFirstClick] = useState<number | null>(null);

  const handleWordClick = useCallback(
    (wordIndex0: number) => {
      const w = wordIndex0 + 1; // 1-indexed
      if (firstClick === null) {
        setFirstClick(w);
      } else {
        const start = Math.min(firstClick, w);
        const end = Math.max(firstClick, w);
        onRangeSelected(start, end);
        setFirstClick(null);
      }
    },
    [firstClick, onRangeSelected]
  );

  const isSelected = (wordIndex0: number): boolean => {
    const w = wordIndex0 + 1;
    if (firstClick !== null && w === firstClick) return true;
    if (selectedRange) {
      return w >= selectedRange[0] && w <= selectedRange[1];
    }
    return false;
  };

  return (
    <div className="font-arabic text-xl leading-loose" dir="rtl">
      {words.map((word, i) => {
        const selected = isSelected(i);
        return (
          <span key={`${ayahKey}:${word.position}`}>
            <span
              className={`cursor-pointer px-1 py-1 rounded transition-colors ${
                selected
                  ? "ring-2 ring-amber-400 bg-amber-500/20"
                  : "hover:bg-slate-600/30"
              }`}
              onClick={() => handleWordClick(i)}
            >
              {word.text}
            </span>
            {i < words.length - 1 && " "}
          </span>
        );
      })}
    </div>
  );
}
