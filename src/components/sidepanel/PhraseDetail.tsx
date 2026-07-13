import type { MutashabihatPhrase } from "@/types";

interface PhraseDetailProps {
  phrase: MutashabihatPhrase;
  onNavigate: (surah: number, ayah: number) => void;
}

function parseAyahKey(key: string): { surah: number; ayah: number } {
  const [surah, ayah] = key.split(":").map(Number);
  return { surah, ayah };
}

export default function PhraseDetail({ phrase, onNavigate }: PhraseDetailProps) {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <div
          className="font-arabic text-2xl text-amber-200 leading-loose"
          dir="rtl"
        >
          {phrase.phraseText}
        </div>
        <div className="text-sm text-slate-400 mt-2">
          {phrase.totalOccurrences} occurrences in {phrase.surahCount} surahs
        </div>
      </div>

      <div className="border-t border-slate-700 pt-3">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">
          Occurrences
        </h3>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {phrase.occurrences.map((occ, idx) => {
            const { surah, ayah } = parseAyahKey(occ.ayahKey);
            const words = occ.ayahText.split(/\s+/);

            return (
              <button
                key={`${occ.ayahKey}-${idx}`}
                onClick={() => onNavigate(surah, ayah)}
                className="w-full text-right p-3 rounded-lg bg-surface hover:bg-surface-lighter border border-slate-700 transition-colors"
              >
                <div className="text-xs text-slate-400 mb-1 font-sans">
                  {occ.ayahKey}
                </div>
                <div
                  className="font-arabic text-lg leading-loose"
                  dir="rtl"
                >
                  {words.map((word, i) => {
                    const highlighted = occ.wordRanges.some(
                      ([s, e]) => i >= s - 1 && i <= e - 1
                    );
                    return (
                      <span key={i}>
                        <span
                          className={
                            highlighted
                              ? "bg-blue-500/30 px-1 rounded"
                              : ""
                          }
                        >
                          {word}
                        </span>
                        {i < words.length - 1 && " "}
                      </span>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
