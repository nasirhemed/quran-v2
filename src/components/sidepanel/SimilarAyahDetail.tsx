import type { SimilarAyahEntry } from "@/types";

interface SimilarAyahDetailProps {
  entry: SimilarAyahEntry;
  onNavigate: (surah: number, ayah: number) => void;
}

function parseAyahKey(key: string): { surah: number; ayah: number } {
  const [surah, ayah] = key.split(":").map(Number);
  return { surah, ayah };
}

export default function SimilarAyahDetail({
  entry,
  onNavigate,
}: SimilarAyahDetailProps) {
  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-xs text-slate-400 mb-1 font-sans">
          Source: {entry.sourceAyahKey}
        </div>
        <div
          className="font-arabic text-2xl text-amber-200 leading-loose"
          dir="rtl"
        >
          {entry.sourceAyahText}
        </div>
        <div className="text-sm text-slate-400 mt-2">
          {entry.similarAyahs.length} similar verses
        </div>
      </div>

      <div className="border-t border-slate-700 pt-3">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">
          Similar Verses
        </h3>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {entry.similarAyahs.map((sim, idx) => {
            const { surah, ayah } = parseAyahKey(sim.ayahKey);
            const words = sim.ayahText.split(/\s+/);

            return (
              <button
                key={`${sim.ayahKey}-${idx}`}
                onClick={() => onNavigate(surah, ayah)}
                className="w-full text-right p-3 rounded-lg bg-surface hover:bg-surface-lighter border border-slate-700 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs text-slate-400 font-sans">
                    {sim.ayahKey}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-sans ${
                        sim.score >= 70
                          ? "bg-emerald-500/20 text-emerald-300"
                          : "bg-slate-600/50 text-slate-300"
                      }`}
                    >
                      {sim.score}% match
                    </span>
                    <span className="text-xs text-slate-500 font-sans">
                      {sim.matchedWordsCount} words
                    </span>
                  </div>
                </div>
                <div
                  className="font-arabic text-lg leading-loose"
                  dir="rtl"
                >
                  {words.map((word, i) => {
                    const highlighted =
                      i >= sim.matchWordsRange[0] - 1 &&
                      i <= sim.matchWordsRange[1] - 1;
                    return (
                      <span key={i}>
                        <span
                          className={
                            highlighted
                              ? "bg-emerald-500/30 px-1 rounded"
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
