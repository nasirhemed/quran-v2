import type { WordSelection, QuranPage } from "@/types";
import { findAyahText } from "@/lib/localPhrases";

interface SelectionActionBarProps {
  selection: WordSelection;
  pages?: QuranPage[];
  onAddPhrase: () => void;
  onClear: () => void;
}

export default function SelectionActionBar({
  selection,
  pages,
  onAddPhrase,
  onClear,
}: SelectionActionBarProps) {
  if (selection.endWord === null) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-edge px-4 py-2.5">
        <div className="max-w-3xl mx-auto flex items-center justify-between font-sans">
          <span className="text-xs sm:text-sm text-muted">
            Tap a second word to complete the selection
          </span>
          <button
            type="button"
            onClick={onClear}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-card2 hover:bg-card2/80 text-ink transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
    );
  }

  // Get the selected text
  const [surahStr, ayahStr] = selection.ayahKey.split(":");
  const text = pages
    ? findAyahText(pages, Number(surahStr), Number(ayahStr))
    : null;
  const selectedText = text
    ? text
        .split(/\s+/)
        .slice(selection.startWord - 1, selection.endWord)
        .join(" ")
    : "";

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-edge px-4 py-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
      <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 font-sans">
        <div className="flex-1 min-w-0">
          <div
            className="font-arabic text-lg text-gold-text truncate"
            dir="rtl"
          >
            {selectedText}
          </div>
          <div className="text-xs text-muted">
            {selection.ayahKey} · words {selection.startWord}–{selection.endWord}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={onClear}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-card2 hover:bg-card2/80 text-ink transition-colors"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onAddPhrase}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary text-on-primary hover:opacity-90 transition-opacity"
          >
            Add Phrase
          </button>
        </div>
      </div>
    </div>
  );
}
