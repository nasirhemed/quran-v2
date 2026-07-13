import type { LocalPhrase } from "@/types";

interface LocalPhraseDetailProps {
  phrase: LocalPhrase;
  onNavigate: (surah: number, ayah: number) => void;
  onDelete?: (phraseId: string) => void;
  onRemoveOccurrence?: (phraseId: string, occurrenceIndex: number) => void;
  onAddOccurrence?: (phraseId: string) => void;
}

function parseAyahKey(key: string): { surah: number; ayah: number } {
  const [surah, ayah] = key.split(":").map(Number);
  return { surah, ayah };
}

export default function LocalPhraseDetail({
  phrase,
  onNavigate,
  onDelete,
  onRemoveOccurrence,
  onAddOccurrence,
}: LocalPhraseDetailProps) {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-300 border border-amber-500/40 font-sans mb-2">
          Custom
        </div>
        <div
          className="font-arabic text-2xl text-amber-200 leading-loose"
          dir="rtl"
        >
          {phrase.phraseText}
        </div>
        <div className="text-sm text-slate-400 mt-2 font-sans">
          {phrase.occurrences.length + 1} occurrence{phrase.occurrences.length !== 0 ? "s" : ""} (including source)
        </div>
      </div>

      {/* Source */}
      <div className="border-t border-slate-700 pt-3">
        <h3 className="text-sm font-semibold text-slate-300 mb-3 font-sans">
          Source
        </h3>
        <button
          onClick={() => {
            const { surah, ayah } = parseAyahKey(phrase.sourceAyah);
            onNavigate(surah, ayah);
          }}
          className="w-full text-right p-3 rounded-lg bg-surface hover:bg-surface-lighter border border-slate-700 transition-colors"
        >
          <div className="text-xs text-slate-400 mb-1 font-sans">
            {phrase.sourceAyah} (words {phrase.sourceWordRange[0]}-{phrase.sourceWordRange[1]})
          </div>
        </button>
      </div>

      {/* Occurrences */}
      <div className="border-t border-slate-700 pt-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-300 font-sans">
            Occurrences
          </h3>
          {onAddOccurrence && (
            <button
              onClick={() => onAddOccurrence(phrase.id)}
              className="px-2 py-1 rounded text-xs bg-amber-600 hover:bg-amber-500 text-white transition-colors font-sans"
            >
              + Add
            </button>
          )}
        </div>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {phrase.occurrences.length === 0 && (
            <div className="text-sm text-slate-500 font-sans">
              No additional occurrences yet
            </div>
          )}
          {phrase.occurrences.map((occ, idx) => {
            const { surah, ayah } = parseAyahKey(occ.ayahKey);
            return (
              <div
                key={`${occ.ayahKey}-${idx}`}
                className="flex items-center gap-2"
              >
                <button
                  onClick={() => onNavigate(surah, ayah)}
                  className="flex-1 text-right p-3 rounded-lg bg-surface hover:bg-surface-lighter border border-slate-700 transition-colors"
                >
                  <div className="text-xs text-slate-400 font-sans">
                    {occ.ayahKey} (words {occ.wordRange[0]}-{occ.wordRange[1]})
                  </div>
                </button>
                {onRemoveOccurrence && (
                  <button
                    onClick={() => onRemoveOccurrence(phrase.id, idx)}
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors shrink-0"
                    title="Remove occurrence"
                  >
                    &times;
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Delete button */}
      {onDelete && (
        <div className="border-t border-slate-700 pt-3">
          <button
            onClick={() => onDelete(phrase.id)}
            className="w-full px-3 py-2 rounded text-sm bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800/50 transition-colors font-sans"
          >
            Delete Phrase
          </button>
        </div>
      )}
    </div>
  );
}
