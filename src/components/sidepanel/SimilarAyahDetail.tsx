import { Link } from "wouter";
import type { SimilarAyahEntry, SurahMeta } from "@/types";
import { surahTname } from "@/lib/quranMeta";

interface SimilarAyahDetailProps {
  entry: SimilarAyahEntry;
  surahs?: SurahMeta[];
  onNavigate: (surah: number, ayah: number) => void;
  onClose?: () => void;
}

function parseAyahKey(key: string): { surah: number; ayah: number } {
  const [surah, ayah] = key.split(":").map(Number);
  return { surah, ayah };
}

export default function SimilarAyahDetail({
  entry,
  surahs,
  onNavigate,
  onClose,
}: SimilarAyahDetailProps) {
  const source = parseAyahKey(entry.sourceAyahKey);
  const sourceLabel = surahs ? `${surahTname(surahs, source.surah)} · ${entry.sourceAyahKey}` : entry.sourceAyahKey;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-ground border border-edge p-4 text-center">
        <div className="text-xs font-semibold text-muted mb-1 font-sans">
          {sourceLabel}
        </div>
        <div className="font-arabic text-2xl text-gold-text leading-loose" dir="rtl" lang="ar">
          {entry.sourceAyahText}
        </div>
        <div className="text-xs text-muted mt-1.5">
          {entry.similarAyahs.length} similar {entry.similarAyahs.length === 1 ? "verse" : "verses"}
        </div>
        <Link
          href={`/browse/surah/${source.surah}/${source.ayah}`}
          onClick={onClose}
          className="inline-flex items-center gap-1 mt-3 px-3 py-1 rounded-full text-xs font-semibold text-primary bg-primary-soft hover:opacity-90 transition-opacity"
        >
          Open in Browse <span aria-hidden>→</span>
        </Link>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted font-sans">
            Similar Verses
          </h3>
          <span className="text-xs text-faint">Tap a verse to jump there</span>
        </div>
        <div className="space-y-2.5">
          {entry.similarAyahs.map((sim, idx) => {
            const { surah, ayah } = parseAyahKey(sim.ayahKey);
            const words = sim.ayahText.split(/\s+/);
            const label = surahs ? `${surahTname(surahs, surah)} · ${sim.ayahKey}` : sim.ayahKey;

            return (
              <button
                key={`${sim.ayahKey}-${idx}`}
                onClick={() => onNavigate(surah, ayah)}
                className="w-full text-left p-3.5 rounded-xl bg-ground hover:bg-card2/70 border border-edge hover:border-primary/50 transition-all group"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="text-xs font-semibold text-primary font-sans truncate">
                    {label}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-semibold font-sans ${
                        sim.score >= 70
                          ? "bg-primary-soft text-primary"
                          : "bg-card2 text-muted"
                      }`}
                    >
                      {sim.score}% match
                    </span>
                    <span className="text-[11px] text-faint font-sans">
                      {sim.matchedWordsCount} {sim.matchedWordsCount === 1 ? "word" : "words"}
                    </span>
                  </div>
                </div>
                <div className="font-arabic text-lg leading-loose text-ink text-right" dir="rtl" lang="ar">
                  {words.map((word, i) => {
                    const highlighted =
                      i >= sim.matchWordsRange[0] - 1 &&
                      i <= sim.matchWordsRange[1] - 1;
                    return (
                      <span key={i}>
                        <span
                          className={highlighted ? "px-1 rounded-sm" : undefined}
                          style={highlighted ? { background: "var(--hl-1-bg)" } : undefined}
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
