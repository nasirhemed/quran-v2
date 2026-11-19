import type { LocalPhrase, SurahMeta } from "@/types";
import { surahTname } from "@/lib/quranMeta";

interface LocalPhraseDetailProps {
  phrase: LocalPhrase;
  surahs?: SurahMeta[];
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
  surahs,
  onNavigate,
  onDelete,
  onRemoveOccurrence,
  onAddOccurrence,
}: LocalPhraseDetailProps) {
  const src = parseAyahKey(phrase.sourceAyah);
  const srcLabel = surahs ? `${surahTname(surahs, src.surah)} · ${phrase.sourceAyah}` : phrase.sourceAyah;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-ground border border-edge p-4 text-center">
        <div className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gold-soft text-gold-text border border-gold/40 font-sans mb-2">
          Custom phrase
        </div>
        <div className="font-arabic text-2xl text-gold-text leading-loose" dir="rtl" lang="ar">
          {phrase.phraseText}
        </div>
        <div className="text-xs text-muted mt-1.5 font-sans">
          {phrase.occurrences.length + 1} occurrence{phrase.occurrences.length !== 0 ? "s" : ""} (including source)
        </div>
      </div>

      {/* Source */}
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted mb-2.5 font-sans">
          Source
        </h3>
        <button
          onClick={() => onNavigate(src.surah, src.ayah)}
          className="w-full text-left p-3.5 rounded-xl bg-ground hover:bg-card2/70 border border-edge hover:border-primary/50 transition-all"
        >
          <div className="text-xs font-semibold text-primary font-sans">{srcLabel}</div>
          <div className="text-xs text-faint mt-0.5 font-sans">
            Words {phrase.sourceWordRange[0]}–{phrase.sourceWordRange[1]}
          </div>
        </button>
      </div>

      {/* Occurrences */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted font-sans">
            Occurrences
          </h3>
          {onAddOccurrence && (
            <button
              onClick={() => onAddOccurrence(phrase.id)}
              className="px-2.5 py-1 rounded-full text-xs font-semibold bg-primary text-on-primary hover:opacity-90 transition-opacity font-sans"
            >
              + Add
            </button>
          )}
        </div>
        <div className="space-y-2">
          {phrase.occurrences.length === 0 && (
            <div className="text-sm text-faint font-sans">No additional occurrences yet</div>
          )}
          {phrase.occurrences.map((occ, idx) => {
            const { surah, ayah } = parseAyahKey(occ.ayahKey);
            const occLabel = surahs ? `${surahTname(surahs, surah)} · ${occ.ayahKey}` : occ.ayahKey;
            return (
              <div key={`${occ.ayahKey}-${idx}`} className="flex items-center gap-2">
                <button
                  onClick={() => onNavigate(surah, ayah)}
                  className="flex-1 text-left p-3 rounded-xl bg-ground hover:bg-card2/70 border border-edge hover:border-primary/50 transition-all"
                >
                  <div className="text-xs font-semibold text-primary font-sans">{occLabel}</div>
                  <div className="text-xs text-faint mt-0.5 font-sans">
                    Words {occ.wordRange[0]}–{occ.wordRange[1]}
                  </div>
                </button>
                {onRemoveOccurrence && (
                  <button
                    onClick={() => onRemoveOccurrence(phrase.id, idx)}
                    className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-red-500/15 text-muted hover:text-red-400 transition-colors shrink-0"
                    title="Remove occurrence"
                    aria-label="Remove occurrence"
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
        <div className="border-t border-edge pt-4">
          <button
            onClick={() => onDelete(phrase.id)}
            className="w-full px-3 py-2.5 rounded-xl text-sm font-semibold text-red-400 border border-red-400/35 hover:bg-red-500/10 transition-colors font-sans"
          >
            Delete Phrase
          </button>
        </div>
      )}
    </div>
  );
}
