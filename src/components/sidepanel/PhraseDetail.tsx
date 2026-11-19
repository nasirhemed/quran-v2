import { Link } from "wouter";
import type { MutashabihatPhrase, SurahMeta } from "@/types";
import { surahTname } from "@/lib/quranMeta";

interface PhraseDetailProps {
  phrase: MutashabihatPhrase;
  surahs?: SurahMeta[];
  onNavigate: (surah: number, ayah: number) => void;
  onClose?: () => void;
}

function parseAyahKey(key: string): { surah: number; ayah: number } {
  const [surah, ayah] = key.split(":").map(Number);
  return { surah, ayah };
}

export default function PhraseDetail({ phrase, surahs, onNavigate, onClose }: PhraseDetailProps) {
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-ground border border-edge p-4 text-center">
        <div className="font-quran text-2xl text-gold-text leading-loose" dir="rtl" lang="ar">
          {phrase.phraseText}
        </div>
        <div className="text-xs text-muted mt-1.5 font-sans">
          {phrase.totalOccurrences} {phrase.totalOccurrences === 1 ? "occurrence" : "occurrences"} across{" "}
          {phrase.surahCount} {phrase.surahCount === 1 ? "surah" : "surahs"}
        </div>
        <Link
          href={`/browse/phrase/${phrase.id}`}
          onClick={onClose}
          className="inline-flex items-center gap-1 mt-3 px-3 py-1 rounded-full text-xs font-semibold text-primary bg-primary-soft hover:opacity-90 transition-opacity"
        >
          Open in Browse <span aria-hidden>→</span>
        </Link>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted font-sans">
            Occurrences
          </h3>
          <span className="text-xs text-faint">Tap a verse to jump there</span>
        </div>
        <div className="space-y-2.5">
          {phrase.occurrences.map((occ, idx) => {
            const { surah, ayah } = parseAyahKey(occ.ayahKey);
            const words = occ.ayahText.split(/\s+/);
            const label = surahs ? `${surahTname(surahs, surah)} · ${occ.ayahKey}` : occ.ayahKey;

            return (
              <button
                key={`${occ.ayahKey}-${idx}`}
                onClick={() => onNavigate(surah, ayah)}
                className="w-full text-left p-3.5 rounded-xl bg-ground hover:bg-card2/70 border border-edge hover:border-primary/50 transition-all group"
              >
                <div className="flex items-center justify-between text-xs mb-1.5 font-sans">
                  <span className="font-semibold text-primary">{label}</span>
                  <span className="text-faint group-hover:text-primary transition-colors" aria-hidden>
                    Jump →
                  </span>
                </div>
                <div className="font-quran text-lg leading-loose text-ink text-right" dir="rtl" lang="ar">
                  {words.map((word, i) => {
                    const highlighted = occ.wordRanges.some(([s, e]) => i >= s - 1 && i <= e - 1);
                    return (
                      <span key={i}>
                        <span
                          className={highlighted ? "px-1 rounded-sm" : undefined}
                          style={highlighted ? { background: "var(--hl-0-bg)" } : undefined}
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
