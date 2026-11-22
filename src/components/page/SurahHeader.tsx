import { SURAH_WORD_LIGATURE, surahNameLigature } from "@/lib/mushaf/pack";

interface SurahHeaderProps {
  surahName: string;
  tname: string;
  surahIndex: number;
  /** draw the name from the mushaf's surah-name font, in one printed line */
  glyphs?: boolean;
  /** the print's surah-name font family, for `glyphs` */
  fontFamily?: string;
}

export default function SurahHeader({ surahName, tname, surahIndex, glyphs, fontFamily }: SurahHeaderProps) {
  if (glyphs && fontFamily) {
    return (
      <div className="mushaf-line justify-center">
        {/* Right to left: the first item, سورة, sits on the right and the name on its left. */}
        <div className="surah-frame" dir="rtl" title={tname}>
          <span aria-hidden="true" className="select-none" style={{ fontFamily: `"${fontFamily}"` }}>
            {SURAH_WORD_LIGATURE}
          </span>
          <span aria-hidden="true" className="select-none" style={{ fontFamily: `"${fontFamily}"` }}>
            {surahNameLigature(surahIndex)}
          </span>
          <span className="sr-only">سورة {surahName}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="w-full my-2 py-1.5 rounded-lg border border-gold/40 bg-card2/30 text-center">
      <div className="font-quran text-xl text-ink leading-snug">{surahName}</div>
      <div className="text-[11px] text-muted font-sans">{tname}</div>
    </div>
  );
}
