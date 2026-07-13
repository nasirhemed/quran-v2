import { useState, useCallback } from "react";
import type { LocalPhrase, SurahMeta, QuranPage } from "@/types";
import { findAyahText } from "@/lib/localPhrases";
import SelectableVerse from "./SelectableVerse";

interface AddOccurrenceDialogProps {
  phrase: LocalPhrase;
  surahs: SurahMeta[];
  pages: QuranPage[];
  onAddOccurrence: (phraseId: string, ayahKey: string, wordRange: [number, number]) => void;
  onDone: () => void;
}

export default function AddOccurrenceDialog({
  phrase,
  surahs,
  pages,
  onAddOccurrence,
  onDone,
}: AddOccurrenceDialogProps) {
  const [surahNum, setSurahNum] = useState(1);
  const [ayahNum, setAyahNum] = useState(1);
  const [targetWords, setTargetWords] = useState<import("@/types").QuranWord[] | null>(null);
  const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null);

  const handleLookup = useCallback(() => {
    // Find the ayah in pages
    let words = null;
    for (const page of pages) {
      for (const group of page.surahGroups) {
        for (const ayah of group.ayahs) {
          if (ayah.surah === surahNum && ayah.ayah === ayahNum) {
            words = ayah.words;
            break;
          }
        }
        if (words) break;
      }
      if (words) break;
    }
    setTargetWords(words);
    setSelectedRange(null);
  }, [pages, surahNum, ayahNum]);

  const handleRangeSelected = useCallback(
    (start: number, end: number) => {
      setSelectedRange([start, end]);
    },
    []
  );

  const handleAddOccurrence = useCallback(() => {
    if (!selectedRange) return;
    const ayahKey = `${surahNum}:${ayahNum}`;
    onAddOccurrence(phrase.id, ayahKey, selectedRange);
    setSelectedRange(null);
    setTargetWords(null);
  }, [selectedRange, surahNum, ayahNum, onAddOccurrence, phrase.id]);

  const selectedSurah = surahs.find((s) => s.index === surahNum);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-light border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-4 border-b border-slate-700">
          <h3 className="text-lg font-semibold text-slate-200 font-sans">
            Add Occurrence
          </h3>
        </div>

        <div className="p-4 space-y-4">
          {/* Source phrase display */}
          <div>
            <div className="text-xs text-slate-400 font-sans mb-1">
              Source phrase
            </div>
            <div
              className="font-arabic text-xl text-amber-200 leading-loose bg-surface rounded p-2"
              dir="rtl"
            >
              {phrase.phraseText}
            </div>
          </div>

          {/* Existing occurrences */}
          {phrase.occurrences.length > 0 && (
            <div>
              <div className="text-xs text-slate-400 font-sans mb-1">
                Existing occurrences ({phrase.occurrences.length})
              </div>
              <div className="space-y-1">
                {phrase.occurrences.map((occ, i) => (
                  <div
                    key={i}
                    className="text-sm text-slate-300 bg-surface rounded px-2 py-1 font-sans"
                  >
                    {occ.ayahKey} (words {occ.wordRange[0]}-{occ.wordRange[1]})
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Target verse lookup */}
          <div className="space-y-2">
            <div className="text-xs text-slate-400 font-sans">
              Find target verse
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-xs text-slate-500 font-sans">Surah</label>
                <select
                  value={surahNum}
                  onChange={(e) => setSurahNum(Number(e.target.value))}
                  className="w-full bg-surface border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 font-sans"
                >
                  {surahs.map((s) => (
                    <option key={s.index} value={s.index}>
                      {s.index}. {s.tname}
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-20">
                <label className="text-xs text-slate-500 font-sans">Ayah</label>
                <input
                  type="number"
                  min={1}
                  max={selectedSurah?.ayas ?? 286}
                  value={ayahNum}
                  onChange={(e) => setAyahNum(Number(e.target.value))}
                  className="w-full bg-surface border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 font-sans"
                />
              </div>
              <button
                onClick={handleLookup}
                className="px-3 py-1.5 rounded text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors shrink-0"
              >
                Look up
              </button>
            </div>
          </div>

          {/* Target verse with selectable words */}
          {targetWords !== null && (
            <div>
              <div className="text-xs text-slate-400 font-sans mb-1">
                Select the matching words
              </div>
              <div className="bg-surface rounded p-3">
                <SelectableVerse
                  words={targetWords}
                  ayahKey={`${surahNum}:${ayahNum}`}
                  selectedRange={selectedRange}
                  onRangeSelected={handleRangeSelected}
                />
              </div>
              {selectedRange && (
                <button
                  onClick={handleAddOccurrence}
                  className="mt-2 w-full px-3 py-2 rounded text-sm bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors font-sans"
                >
                  Add Occurrence (words {selectedRange[0]}-{selectedRange[1]})
                </button>
              )}
            </div>
          )}
          {targetWords === null && surahNum > 0 && ayahNum > 0 && (
            <div className="text-sm text-slate-500 font-sans">
              Enter surah and ayah number, then click "Look up"
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-700 flex justify-end">
          <button
            onClick={onDone}
            className="px-4 py-2 rounded text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors font-sans"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
