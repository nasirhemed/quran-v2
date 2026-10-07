import { useSurahNamesFont } from "@/hooks/useMushafFonts";
import { SURAH_NAMES_FAMILY, surahNameLigature } from "@/lib/mushaf/pack";

/**
 * A surah's Arabic name, drawn as the mushaf's headers draw it (the surah-name font's calligraphy, as on quran.com).
 * Until that font is on the device, or where it isn't hosted, the name is text in the QPC Hafs font.
 */
export default function SurahName({ surah, name, className = "" }: { surah: number; name: string; className?: string }) {
  const calligraphy = useSurahNamesFont();
  if (!calligraphy) {
    return (
      <span dir="rtl" lang="ar" className={`font-quran ${className}`}>
        {name}
      </span>
    );
  }
  return (
    <span dir="rtl" lang="ar" className={`leading-none ${className}`}>
      {/* the ligature "001"…"114" draws the name; screen readers get the text */}
      <span aria-hidden="true" className="select-none text-[1.35em]" style={{ fontFamily: `"${SURAH_NAMES_FAMILY}"` }}>
        {surahNameLigature(surah)}
      </span>
      <span className="sr-only">{name}</span>
    </span>
  );
}
