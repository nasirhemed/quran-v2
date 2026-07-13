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
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface-light border-t border-slate-700 p-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between font-sans">
          <span className="text-sm text-slate-400">
            Tap a second word to complete the selection
          </span>
          <button
            onClick={onClear}
            className="px-3 py-1.5 rounded text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
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
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface-light border-t border-slate-700 p-3">
      <div className="max-w-3xl mx-auto flex items-center justify-between gap-3 font-sans">
        <div className="flex-1 min-w-0">
          <div
            className="font-arabic text-lg text-amber-200 truncate"
            dir="rtl"
          >
            {selectedText}
          </div>
          <div className="text-xs text-slate-400">
            {selection.ayahKey} words {selection.startWord}-{selection.endWord}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onClear}
            className="px-3 py-1.5 rounded text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={onAddPhrase}
            className="px-3 py-1.5 rounded text-sm bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors"
          >
            Add Similar Phrase
          </button>
        </div>
      </div>
    </div>
  );
}
